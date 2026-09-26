/* 浏览器端光栅化与导出：
   清晰度三档对齐桌面版 export.ts / ExportView.vue：
   - original 原图：1 倍截图 · 无损 PNG
   - hd 高清：3.125 倍（300 DPI）
   - compressed 压缩：单张 ≤2MB，超限逐级降 JPEG 质量（q92→40，步长 8，同 compressToTarget）
   分块截图拼接规避浏览器画布尺寸上限（对齐 export.ts exportOneLong 的分块思路）。 */
;(function (global) {
  'use strict'

  var MAX_SIDE_CSS = 8192 // 单块画布边上限（保守取 Safari 限制）
  var MAX_AREA_DEV = 3e7 // 画布总像素安全线
  var COMPRESS_TARGET_BYTES = 2 * 1024 * 1024 // 社媒单图 ≤2MB

  function scaleFor(quality) {
    return quality === 'hd' ? 3.125 : 1
  }

  function sanitizeName(s) {
    var t = String(s).replace(/[\\/:*?"<>|\u0000-\u001f]/g, '').trim()
    return (t || '未命名').slice(0, 60)
  }

  function formatBytes(n) {
    if (n >= 1024 * 1024) return (n / 1024 / 1024).toFixed(n >= 10 * 1024 * 1024 ? 0 : 1) + ' MB'
    if (n >= 1024) return Math.round(n / 1024) + ' KB'
    return Math.round(n) + ' B'
  }

  function stageEl(el) {
    var stage = document.createElement('div')
    stage.style.cssText = 'position:absolute;left:-100000px;top:0;'
    stage.appendChild(el)
    document.body.appendChild(stage)
    return stage
  }

  /** el → 完整 canvas */
  async function elementToCanvas(el, opts) {
    var scale = opts.scale || 1
    var stage = stageEl(el)
    var widthCss = Math.ceil(el.getBoundingClientRect().width)
    var heightCss = Math.ceil(el.getBoundingClientRect().height)
    if (!widthCss || !heightCss) {
      stage.remove()
      throw new Error('内容为空，无法导出')
    }

    var totalDev = widthCss * scale * heightCss * scale
    if (totalDev > MAX_AREA_DEV) {
      stage.remove()
      throw new Error('图片过大（约 ' + Math.round(totalDev / 1e6) + ' 百万像素），请降低清晰度或减少内容后重试')
    }

    try {
      await global.RENDER.settle(stage)
      var final = document.createElement('canvas')
      final.width = Math.round(widthCss * scale)
      final.height = Math.round(heightCss * scale)
      var fctx = final.getContext('2d')
      fctx.fillStyle = '#ffffff'
      fctx.fillRect(0, 0, final.width, final.height)

      var chunkCssH = Math.max(
        1,
        Math.min(heightCss, Math.floor(Math.min(MAX_SIDE_CSS, MAX_AREA_DEV / (final.width || 1)) / scale))
      )
      var y = 0
      while (y < heightCss) {
        var h = Math.min(chunkCssH, heightCss - y)
        var viewport = document.createElement('div')
        viewport.style.cssText =
          'position:absolute;left:0;top:0;width:' +
          widthCss +
          'px;height:' +
          h +
          'px;overflow:hidden;background:#ffffff;'
        var mover = document.createElement('div')
        mover.style.cssText = 'position:absolute;left:0;top:' + -y + 'px;width:' + widthCss + 'px;'
        mover.appendChild(el)
        viewport.appendChild(mover)
        stage.appendChild(viewport)

        var chunkCanvas = await global.html2canvas(viewport, {
          scale: scale,
          backgroundColor: '#ffffff',
          useCORS: true,
          logging: false,
          width: widthCss,
          height: h,
          windowWidth: Math.max(document.documentElement.clientWidth, widthCss),
          windowHeight: Math.max(document.documentElement.clientHeight, h)
        })
        fctx.drawImage(chunkCanvas, 0, Math.round(y * scale))
        viewport.remove()
        chunkCanvas.width = chunkCanvas.height = 0
        y += h
        if (opts.onProgress) opts.onProgress(Math.min(y, heightCss), heightCss)
      }
      return final
    } finally {
      if (el.parentNode) el.parentNode.removeChild(el)
      stage.remove()
    }
  }

  function canvasToBlob(canvas, mime, quality) {
    return new Promise(function (resolve, reject) {
      canvas.toBlob(
        function (b) {
          b ? resolve(b) : reject(new Error('图片生成失败'))
        },
        mime,
        quality
      )
    })
  }

  /** 成品编码：compressed 档超 2MB 时逐级降 JPEG 质量（同桌面版 compressToTarget） */
  async function encodeCanvas(canvas, quality, format) {
    if (quality === 'compressed') {
      var buf = await canvasToBlob(canvas, 'image/jpeg', 0.92)
      for (var q = 0.92; buf.size > COMPRESS_TARGET_BYTES && q > 0.4; q -= 0.08) {
        buf = await canvasToBlob(canvas, 'image/jpeg', Math.max(0.4, q - 0.08))
      }
      return { blob: buf, ext: 'jpg' }
    }
    var mime = format === 'jpeg' ? 'image/jpeg' : 'image/png'
    var blob = await canvasToBlob(canvas, mime, format === 'jpeg' ? 0.92 : undefined)
    return { blob: blob, ext: format === 'jpeg' ? 'jpg' : 'png' }
  }

  function saveBlob(blob, name) {
    var a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = name
    document.body.appendChild(a)
    a.click()
    setTimeout(function () {
      URL.revokeObjectURL(a.href)
      a.remove()
    }, 4000)
  }

  /** 导出执行器：targets=[{name, el}] → 逐张光栅化；多张打 ZIP。
   *  opts: { quality, format, onStep(i,n), onProgress(imgIdx,imgTotal,done,total) }
   *  返回 { files:[{name,size}], totalBytes, zipSize } */
  async function runExport(targets, opts) {
    var scale = scaleFor(opts.quality)
    var files = []
    for (var i = 0; i < targets.length; i++) {
      var t = targets[i]
      if (opts.onStep) opts.onStep(i + 1, targets.length, t.name)
      var canvas = await elementToCanvas(t.el, {
        scale: scale,
        onProgress: opts.onProgress
          ? function (done, total) {
              opts.onProgress(i + 1, targets.length, done, total)
            }
          : null
      })
      var enc = await encodeCanvas(canvas, opts.quality, opts.format)
      var name = sanitizeName(t.name) + '.' + enc.ext
      files.push({ name: name, blob: enc.blob, size: enc.blob.size })
      canvas.width = canvas.height = 0
    }

    var totalBytes = files.reduce(function (s, f) {
      return s + f.size
    }, 0)
    var zipSize = 0
    if (files.length === 1) {
      saveBlob(files[0].blob, files[0].name)
    } else {
      var zip = new global.JSZip()
      files.forEach(function (f) {
        zip.file(f.name, f.blob)
      })
      var zblob = await zip.generateAsync({ type: 'blob' })
      zipSize = zblob.size
      saveBlob(zblob, sanitizeName(opts.zipName || '长图') + '.zip')
    }
    return { files: files, totalBytes: totalBytes, zipSize: zipSize }
  }

  global.EXPORT = {
    runExport: runExport,
    sanitizeName: sanitizeName,
    elementToCanvas: elementToCanvas,
    scaleFor: scaleFor,
    formatBytes: formatBytes,
    COMPRESS_TARGET_BYTES: COMPRESS_TARGET_BYTES
  }
})(window)
