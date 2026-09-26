/* 长图排版：画布预设（数值复刻桌面版 paper.ts / layout.ts）+ 排版壳构建与块 HTML 生成。
   预览即编辑器：flow 本身是 contenteditable，导出时把其顶层子节点克隆进 buildShell 的新壳。 */
;(function (global) {
  'use strict'

  // 手机长图：1080px 宽。静态页专用默认值（桌面版 paper.ts mobileLong 是 56/48/72/48、正文 32px、行距 1.75）：
  // 顶部 +200、左右 100、正文 36px；行/段/字间距用 px（行距 63px≈1.75 倍，段距 29px≈原 0.8em）。
  // 页边距为 1:1 语义（见 applyCanvas）→ 边距数值＝实际留白。
  var CANVAS = {
    mobileLong: {
      key: 'mobileLong',
      label: '手机长图',
      widthPx: 1080,
      marginsPx: [256, 100, 72, 100],
      typo: { bodySize: 36, linePx: 63, paraGapPx: 29, letterSpacingPx: 0 }
    }
  }

  // defaultTypography 的标题缩放（layout.ts）
  var SCALES = { h0: 2.2, h1: 1.7, h2: 1.4, h3: 1.2, h4: 1.1, h5: 1.05, h6: 1 }

  function esc(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
  }

  function renderSpans(spans) {
    var html = ''
    for (var i = 0; i < spans.length; i++) {
      var sp = spans[i]
      switch (sp.t) {
        case 'text':
          html += esc(sp.v).replace(/\n/g, '<br>')
          break
        case 'b':
          html += '<strong>' + renderSpans(sp.v) + '</strong>'
          break
        case 'i':
          html += '<em>' + renderSpans(sp.v) + '</em>'
          break
        case 's':
          html += '<s>' + renderSpans(sp.v) + '</s>'
          break
        case 'a':
          html += '<a href="' + esc(sp.href) + '">' + renderSpans(sp.v) + '</a>'
          break
        case 'img':
          html += '<img src="' + esc(sp.src) + '" alt="' + esc(sp.alt) + '">'
          break
      }
    }
    return html
  }

  function blockHtml(b) {
    switch (b.type) {
      case 'h':
        return '<h' + b.level + '>' + renderSpans(b.spans) + '</h' + b.level + '>'
      case 'p':
        return '<p>' + renderSpans(b.spans) + '</p>'
      case 'hr':
        return '<hr>'
      case 'code':
        return '<pre class="code-block">' + esc(b.text) + '</pre>'
      case 'quote':
        var paras = b.text.split('\n').filter(function (t) {
          return t.trim() !== ''
        })
        if (!paras.length) paras = ['']
        return (
          '<blockquote>' +
          paras
            .map(function (t) {
              return '<p>' + renderSpans(global.MD.inline(t)) + '</p>'
            })
            .join('') +
          '</blockquote>'
        )
      case 'ul':
      case 'ol':
        return (
          '<' +
          b.type +
          '>' +
          b.items
            .map(function (spans) {
              return '<li><p>' + renderSpans(spans) + '</p></li>'
            })
            .join('') +
          '</' +
          b.type +
          '>'
        )
      default:
        return ''
    }
  }

  function blocksToHtml(blocks) {
    return blocks.map(blockHtml).join('')
  }

  /** 默认排版设置（px 单位），app.js 以此为基准合并用户设置 */
  function defaultTypo() {
    var d = CANVAS.mobileLong
    return {
      marginsPx: d.marginsPx.slice(),
      bodySize: d.typo.bodySize,
      linePx: d.typo.linePx,
      paraGapPx: d.typo.paraGapPx,
      letterSpacingPx: d.typo.letterSpacingPx
    }
  }

  /** 把画布几何/排版设置应用到 wrap 及其中的每条 flow（预览与导出壳共用）。
   *  每条 flow 独立可编辑（标题流、正文流）。 */
  function applyCanvas(wrap, s) {
    s = s || defaultTypo()
    var w = CANVAS.mobileLong.widthPx
    wrap.style.width = Math.round(w) + 'px'
    wrap.style.backgroundColor = '#ffffff'
    // 页边距 1:1 语义：padding 挂在 wrap 上，flow 占满版心 → 边距数值＝实际留白
    // （静态页有意偏离桌面版 flowShell 的双倍横向边距语义，便于直接调边距）
    wrap.style.padding =
      s.marginsPx[0] + 'px ' + s.marginsPx[1] + 'px ' + s.marginsPx[2] + 'px ' + s.marginsPx[3] + 'px'
    wrap.style.setProperty('--ts-body', s.bodySize + 'px')
    wrap.style.setProperty('--tl-body', s.linePx + 'px')
    wrap.style.setProperty('--tp-gap', s.paraGapPx + 'px')
    wrap.style.setProperty('--ls', s.letterSpacingPx + 'px')
    for (var k in SCALES) wrap.style.setProperty('--sc-' + k, SCALES[k])
    var contentW = Math.round(w - s.marginsPx[1] - s.marginsPx[3]) + 'px'
    Array.prototype.forEach.call(wrap.children, function (flow) {
      flow.style.width = contentW
      flow.style.padding = '0'
    })
    return s
  }

  /** 导出壳：wrap 管背景与页边距，标题流/正文流各一条（均不带 contenteditable，
   *  与编辑器样式选择器天然隔离）。 */
  function buildShell(s) {
    var wrap = document.createElement('div')
    wrap.className = 'long-wrap'
    var title = document.createElement('div')
    title.className = 'tiptap-prose title-flow'
    var flow = document.createElement('div')
    flow.className = 'tiptap-prose paged-flow'
    wrap.appendChild(title)
    wrap.appendChild(flow)
    var used = applyCanvas(wrap, s)
    return { wrap: wrap, title: title, flow: flow, settings: used }
  }

  /** 等字体与图片就绪（对齐 render-shared.ts settle） */
  function settle(root) {
    var imgs = Array.prototype.slice.call(root.querySelectorAll('img'))
    return Promise.all(
      imgs.map(function (im) {
        if (im.decode) return im.decode().catch(function () {})
        return new Promise(function (res) {
          if (im.complete) res()
          else {
            im.onload = im.onerror = res
          }
        })
      })
    )
      .then(function () {
        return document.fonts && document.fonts.ready
      })
      .then(function () {
        // 页面隐藏时 rAF 会挂起：用超时兜底，保证后台标签页也能完成导出
        return new Promise(function (res) {
          var done = false
          function ok() {
            if (!done) {
              done = true
              res()
            }
          }
          requestAnimationFrame(function () {
            requestAnimationFrame(ok)
          })
          setTimeout(ok, 120)
        })
      })
  }

  global.RENDER = {
    CANVAS: CANVAS,
    defaultTypo: defaultTypo,
    applyCanvas: applyCanvas,
    buildShell: buildShell,
    blockHtml: blockHtml,
    blocksToHtml: blocksToHtml,
    settle: settle,
    esc: esc
  }
})(window)
