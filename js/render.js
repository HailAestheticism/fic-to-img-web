/* 长图排版：画布预设（数值复刻桌面版 paper.ts / layout.ts）+ 排版壳构建与块 HTML 生成。
   预览即编辑器：flow 本身是 contenteditable，导出时把其顶层子节点克隆进 buildShell 的新壳。 */
;(function (global) {
  'use strict'

  // 手机长图：1080px 宽，边距 256/100/72/100 px（上/右/下/左），正文 36px / 行距 1.75。
  // 静态页专用取值：桌面版 paper.ts mobileLong（56/48/72/48、正文 32px）基础上顶部 +200、正文 36px、左右 100；
  // 边距为 1:1 语义（见 applyCanvas）→ 文字距画布左右各 100px。
  var CANVAS = {
    mobileLong: {
      key: 'mobileLong',
      label: '手机长图',
      widthPx: 1080,
      marginsPx: [256, 100, 72, 100],
      typo: { bodySize: 36, bodyLineHeight: '1.75' }
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
        case 'code':
          html += '<code>' + esc(sp.v) + '</code>'
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

  /** 把画布几何/排版变量应用到一套 wrap 及其中的每个 flow（预览与导出壳共用）。
   *  wrap 内每个直接子元素都是一条 flow（标题流、正文流），各自独立编辑、互不影响。 */
  function applyCanvas(wrap, canvasKey) {
    var c = CANVAS[canvasKey] || CANVAS.mobileLong
    wrap.style.width = Math.round(c.widthPx) + 'px'
    wrap.style.backgroundColor = '#ffffff'
    // 页边距 1:1 语义：padding 挂在 wrap 上，flow 占满版心 → 边距数值＝实际留白
    // （静态页有意偏离桌面版 flowShell 的双倍横向边距语义，便于直接调边距）
    wrap.style.padding =
      c.marginsPx[0] + 'px ' + c.marginsPx[1] + 'px ' + c.marginsPx[2] + 'px ' + c.marginsPx[3] + 'px'
    wrap.style.setProperty('--ts-body', c.typo.bodySize + 'px')
    wrap.style.setProperty('--tl-body', c.typo.bodyLineHeight)
    for (var k in SCALES) wrap.style.setProperty('--sc-' + k, SCALES[k])
    var contentW = Math.round(c.widthPx - c.marginsPx[1] - c.marginsPx[3]) + 'px'
    Array.prototype.forEach.call(wrap.children, function (flow) {
      flow.style.width = contentW
      flow.style.padding = '0'
    })
    return c
  }

  /** 导出壳：wrap 管背景与页边距，标题流/正文流各一条（均不带 contenteditable，
   *  与编辑器样式选择器天然隔离）。 */
  function buildShell(canvasKey) {
    var wrap = document.createElement('div')
    wrap.className = 'long-wrap'
    var title = document.createElement('div')
    title.className = 'tiptap-prose title-flow'
    var flow = document.createElement('div')
    flow.className = 'tiptap-prose paged-flow'
    wrap.appendChild(title)
    wrap.appendChild(flow)
    var c = applyCanvas(wrap, canvasKey)
    return { wrap: wrap, title: title, flow: flow, geom: c }
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
    applyCanvas: applyCanvas,
    buildShell: buildShell,
    blockHtml: blockHtml,
    blocksToHtml: blocksToHtml,
    settle: settle,
    esc: esc
  }
})(window)
