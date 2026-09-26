/* 页面主控：左侧排版面即编辑器（contenteditable），右侧仅导出区。
   分章以排版面顶层 H1 定界；导出克隆节点进新壳，与编辑器样式隔离。 */
;(function () {
  'use strict'

  var $ = function (id) {
    return document.getElementById(id)
  }

  var SAMPLE_BLOCKS = [
    '# 使用说明',
    '',
    '左侧就是最终长图，直接在上面打字或粘贴即可。粘贴带 Markdown 记号的文本会自动识别为格式：',
    '**加粗**、*斜体*、~~删除线~~、> 引用、- 列表、1. 有序列表、--- 分割线、[链接](https://example.com)、![图片](图片网址)。',
    '',
    '顶部这一行大字是文档标题（导出文件名也用它）。选中文字后用「基本」页可加粗、斜体、下划线、删除线、四种对齐，以及按两字宽增加/减少缩进。',
    '',
    '「排版」页用 px 直接调字号、行间距、段间距、字间距和四边页边距，改完即刻生效。',
    '',
    '# 第一章 示例章节',
    '',
    '以「# 一级标题」开头的内容会被视为一个新章节。',
    '',
    '选择「分章节多图」时，每个一级标题各自成图，自动打包为 ZIP 下载。',
    '',
    '## 小节示例',
    '',
    '- 二级及更小的标题不影响分章；',
    '- 全文一图则忽略章节边界，直出一张。',
    '',
    '> 提示：本页为纯静态工具，文字只在您的浏览器里处理，不会上传。'
  ].join('\n')

  // 体积预估经验系数：与桌面版 shared/types.ts 同源
  var SIZE = {
    bytesPerKpx: { png: 76, jpeg: 322 },
    hdFactor: 2.35,
    flowImageKB: 2,
    zipRatio: 0.96,
    compressBlurPx: 2000000
  }

  var store = {
    load: function () {
      try {
        return JSON.parse(localStorage.getItem('webapp-state') || '{}')
      } catch (e) {
        return {}
      }
    },
    save: function (s) {
      try {
        localStorage.setItem('webapp-state', JSON.stringify(s))
      } catch (e) {}
    }
  }

  var saved = store.load()

  /* ---------- 排版参数（px）：默认值取自 render.js 预设，用户设置覆盖之 ---------- */

  // 范围只在这里定义一份，input 的 min/max/step 由 bindTypo() 写入
  var TYPO_LIMITS = {
    bodySize: { min: 12, max: 96, step: 1 },
    linePx: { min: 10, max: 300, step: 1 },
    paraGapPx: { min: 0, max: 300, step: 1 },
    letterSpacingPx: { min: -5, max: 40, step: 0.5 }
  }
  var MARGIN_LIMIT = { min: 0, max: 600, step: 1 }

  function clamp(v, lim) {
    var n = parseFloat(v)
    if (isNaN(n)) return null
    return Math.min(lim.max, Math.max(lim.min, n))
  }

  /** 存档排版设置逐项校验后合并到默认值（缺失/非数字/越界都退回默认，防止坏存档毁掉排版） */
  function loadTypo() {
    var t = RENDER.defaultTypo()
    var s = saved.typo || {}
    Object.keys(TYPO_LIMITS).forEach(function (k) {
      var v = clamp(s[k], TYPO_LIMITS[k])
      if (v !== null) t[k] = v
    })
    if (Array.isArray(s.marginsPx)) {
      for (var i = 0; i < 4; i++) {
        var m = clamp(s.marginsPx[i], MARGIN_LIMIT)
        if (m !== null) t.marginsPx[i] = m
      }
    }
    return t
  }

  var state = {
    mode: saved.mode === 'chapter' ? 'chapter' : 'all',
    fmt: saved.fmt === 'jpeg' ? 'jpeg' : 'png',
    quality: ['original', 'hd', 'compressed'].indexOf(saved.quality) >= 0 ? saved.quality : 'original',
    typo: loadTypo()
  }

  var els = {
    flow: $('paperFlow'),
    titleFlow: $('titleFlow'),
    paperWrap: $('paperWrap'),
    previewCol: $('previewCol'),
    sized: $('previewSized'),
    scaler: $('previewScaler'),
    statChars: $('statChars'),
    statChapters: $('statChapters'),
    exportBtn: $('exportBtn'),
    exportHint: $('exportHint'),
    qualityHint: $('qualityHint'),
    sizeEstimate: $('sizeEstimate'),
    compressWarn: $('compressWarn'),
    mdTools: $('mdTools'),
    panels: $('toolPanels')
  }

  var QUALITY_HINTS = {
    original: '1 倍截图 · 无损',
    hd: '300 DPI · 适合印刷',
    compressed: '单张 ≤2MB · 适应社媒（强制 JPG）'
  }

  // 手机页面比例 x:y≈390:844；视口宽高比 < 2x:y（≈12:13）视为手机端
  var MQ_MOBILE = window.matchMedia('(max-aspect-ratio: 12/13)')
  function isMobile() {
    return MQ_MOBILE.matches
  }

  /* ---------- 排版面初始化（标题流与正文流各自独立编辑） ---------- */

  var UNTITLED = '无标题'
  // 示例内容只在首次访问（无存档）时出现；点进对应编辑区即清空，且不回填
  // 注意用 hasOwnProperty：正文清空后存档是空串，falsy 会被误判成"首次访问"
  var hasSave = Object.prototype.hasOwnProperty.call(saved, 'html')
  var sampleTitle = !hasSave
  var sampleBody = !hasSave

  function titleText() {
    return (els.titleFlow.textContent || '').trim()
  }

  function setTitleText(s) {
    els.titleFlow.innerHTML = '<h0 class="doc-title">' + RENDER.esc(s) + '</h0>'
  }

  // 标题流只放一个 h0（导出取字与样式都依赖它）；全选后打字会把 h0 冲掉，故离开/导出前修回
  function titleHtml() {
    var n = els.titleFlow.firstChild
    var single = els.titleFlow.childNodes.length === 1 && n && n.nodeType === 1 && n.tagName === 'H0'
    if (single) return els.titleFlow.innerHTML
    return '<h0 class="doc-title">' + els.titleFlow.innerHTML + '</h0>'
  }

  function normalizeTitle() {
    els.titleFlow.innerHTML = titleHtml()
  }

  function initContent() {
    if (hasSave) {
      var tmp = document.createElement('div')
      tmp.innerHTML = saved.html
      // 旧存档把标题混在正文流里，迁回标题流
      var legacy = tmp.querySelector('h0.doc-title')
      var t = legacy ? legacy.textContent.trim() : ''
      if (legacy) legacy.remove()
      if (saved.titleHtml) {
        els.titleFlow.innerHTML = saved.titleHtml
      } else {
        setTitleText(t || saved.title || '')
      }
      if (!titleText()) setTitleText(UNTITLED)
      els.flow.innerHTML = tmp.innerHTML
    } else {
      setTitleText('示例文档')
      els.flow.innerHTML = RENDER.blocksToHtml(MD.parse(SAMPLE_BLOCKS))
    }
  }

  function applyCanvas() {
    RENDER.applyCanvas(els.paperWrap, state.typo)
    document.body.classList.toggle('mode-chapter', state.mode === 'chapter')
    scheduleScale()
  }

  /* ---------- 预览缩放（fit 到容器宽，仅预览；导出按原始尺寸） ---------- */

  function applyScale() {
    var w = els.paperWrap.offsetWidth
    var h = els.paperWrap.offsetHeight
    var avail = els.previewCol.clientWidth - (isMobile() ? 16 : 48)
    // 手机端始终缩放到与页面等宽；宽屏保持原尺寸为主（fit 上限 1）
    var s = isMobile() ? avail / w : Math.min(1, avail / w)
    els.scaler.style.transform = 'scale(' + s + ')'
    els.sized.style.width = w * s + 'px'
    els.sized.style.height = h * s + 'px'
  }

  var scaleRaf = null
  function scheduleScale() {
    if (scaleRaf) cancelAnimationFrame(scaleRaf)
    scaleRaf = requestAnimationFrame(applyScale)
  }

  /* ---------- 分章（DOM 顶层 H1 定界） ---------- */

  function docBlocks() {
    return Array.prototype.slice.call(els.flow.children)
  }

  /** [{title, nodes:[Element]}]；H1 前内容归「序章」；无 H1 全文一章 */
  function chaptersFromDom() {
    var blocks = docBlocks()
    var marks = []
    blocks.forEach(function (n, i) {
      if (n.tagName === 'H1') marks.push({ index: i, title: n.textContent.trim() || '未命名章' })
    })
    if (!marks.length) return [{ title: '全文', nodes: blocks }]
    var chs = []
    if (marks[0].index > 0) {
      chs.push({ title: '序章', nodes: blocks.slice(0, marks[0].index) })
    }
    marks.forEach(function (m, k) {
      var end = k + 1 < marks.length ? marks[k + 1].index : blocks.length
      chs.push({ title: m.title, nodes: blocks.slice(m.index, end) })
    })
    return chs
  }

  /* ---------- 导出目标：克隆节点进新壳 ---------- */

  function baseName() {
    return EXPORT.sanitizeName(titleText() || '文档')
  }

  function cloneTitleInto(shell) {
    if (!titleText()) return
    normalizeTitle()
    var kids = els.titleFlow.children
    for (var i = 0; i < kids.length; i++) shell.title.appendChild(kids[i].cloneNode(true))
  }

  function shellWith(nodes) {
    var shell = RENDER.buildShell(state.typo)
    cloneTitleInto(shell)
    nodes.forEach(function (n) {
      shell.flow.appendChild(n.cloneNode(true))
    })
    return shell.wrap
  }

  function buildTargets() {
    if (state.mode !== 'chapter') {
      return [{ name: baseName() + '-长图', el: shellWith(docBlocks()) }]
    }
    var chs = chaptersFromDom()
    return chs.map(function (ch, i) {
      var shell = RENDER.buildShell(state.typo)
      // 文档标题只落在第一张图（对齐桌面版：docTitle 属于首章/序章）
      if (i === 0) cloneTitleInto(shell)
      ch.nodes.forEach(function (n) {
        shell.flow.appendChild(n.cloneNode(true))
      })
      return {
        name: baseName() + '-长图-' + (i + 1) + '-' + EXPORT.sanitizeName(ch.title),
        el: shell.wrap
      }
    })
  }

  /* ---------- 大小预估（临时挂载量高，系数与桌面版一致） ---------- */

  var estTimer = null
  function scheduleEstimate() {
    clearTimeout(estTimer)
    estTimer = setTimeout(updateEstimate, 500)
  }

  function measureShell(el) {
    var probe = document.createElement('div')
    probe.style.cssText = 'position:absolute;left:-100000px;top:0;'
    probe.appendChild(el)
    document.body.appendChild(probe)
    var w = Math.round(RENDER.CANVAS.mobileLong.widthPx)
    var mg = state.typo.marginsPx
    var inkH = Math.max(0, el.offsetHeight - mg[0] - mg[2])
    var contentW = Math.round(w - mg[1] - mg[3])
    probe.remove()
    return { w: w, h: el.offsetHeight, ink: contentW * inkH }
  }

  function updateEstimate() {
    var targets
    try {
      targets = buildTargets()
    } catch (e) {
      return
    }
    var scale = EXPORT.scaleFor(state.quality)
    var perKpx = (state.quality === 'compressed' ? SIZE.bytesPerKpx.jpeg : SIZE.bytesPerKpx[state.fmt]) *
      (state.quality === 'hd' ? SIZE.hdFactor : 1)
    var bytes = 0
    var overBlur = false
    var sizes = []
    targets.forEach(function (t) {
      var m = measureShell(t.el)
      var b = (m.ink / 1000) * perKpx + SIZE.flowImageKB * 1024
      if (state.quality === 'compressed') {
        b = Math.min(b, 2 * 1024 * 1024)
        if (m.w * scale * m.h * scale > SIZE.compressBlurPx) overBlur = true
      }
      sizes.push(b)
      bytes += b
    })
    var zipped = targets.length > 1
    if (zipped) bytes *= 1 + SIZE.zipRatio
    els.sizeEstimate.textContent =
      '预计 ' + targets.length + ' 个文件 · 约 ' + EXPORT.formatBytes(bytes) + (zipped ? '（含打包）' : '')

    if (overBlur) {
      els.compressWarn.hidden = false
      els.compressWarn.textContent = '图片尺寸过大，压缩会导致模糊，建议改用原图或减少内容。'
    } else {
      els.compressWarn.hidden = true
    }
  }

  function updateStats() {
    var chars = (titleText() + (els.flow.innerText || '')).replace(/\s/g, '').length
    els.statChars.textContent = chars + ' 字'
    var marks = docBlocks().filter(function (n) {
      return n.tagName === 'H1'
    })
    els.statChapters.textContent = marks.length
      ? '检测到 ' + marks.length + ' 个一级标题章节'
      : '无一级标题（分章导出时全文为一张）'
  }

  /* ---------- 输入监听 ---------- */

  var saveTimer = null
  function onEdit() {
    scheduleScale()
    updateStats()
    scheduleEstimate()
    clearTimeout(saveTimer)
    saveTimer = setTimeout(function () {
      store.save({
        mode: state.mode,
        fmt: state.fmt,
        quality: state.quality,
        typo: state.typo,
        titleHtml: titleHtml(),
        html: els.flow.innerHTML
      })
    }, 600)
  }

  els.flow.addEventListener('input', onEdit)
  els.titleFlow.addEventListener('input', onEdit)

  /* ---------- 编辑区进出：初始示例点击即清空；离开时空标题回填「无标题」 ---------- */

  var lastFocusFlow = null

  function enterTitle() {
    lastFocusFlow = els.titleFlow
    if (sampleTitle || titleText() === UNTITLED) {
      setTitleText('')
      sampleTitle = false
      onEdit()
    }
  }

  function enterBody() {
    lastFocusFlow = els.flow
    // 正文离开后不回填示例，故只在示例仍原样展示时清一次
    if (sampleBody) {
      els.flow.innerHTML = ''
      sampleBody = false
      onEdit()
    }
  }

  // 点击与聚焦双通道：内容区首次进入时都要清示例（focus 在窗口未激活时会迟到）
  els.titleFlow.addEventListener('pointerdown', enterTitle)
  els.titleFlow.addEventListener('focus', enterTitle)
  els.flow.addEventListener('pointerdown', enterBody)
  els.flow.addEventListener('focus', enterBody)

  els.titleFlow.addEventListener('blur', function () {
    normalizeTitle()
    if (!titleText()) setTitleText(UNTITLED)
    onEdit()
  })

  // 标题单行：回车不拆分，避免正文块混进标题流
  els.titleFlow.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') e.preventDefault()
  })

  /* ---------- 粘贴：识别 Markdown ---------- */

  var MD_HINT = /(^|\n)#{1,6}\s|(^|\n)>\s|(^|\n)\s*[-*+]\s|(^|\n)\s*\d+[.)]\s|(^|\n)```|\*\*|~~|!?\[[^\]]*\]\(/

  els.flow.addEventListener('paste', function (e) {
    var text = (e.clipboardData || window.clipboardData).getData('text/plain')
    if (!text) return
    e.preventDefault()
    if (MD_HINT.test(text)) {
      document.execCommand('insertHTML', false, RENDER.blocksToHtml(MD.parse(text)))
    } else {
      document.execCommand('insertText', false, text)
    }
    onEdit()
  })

  // 标题流只收单行纯文本
  els.titleFlow.addEventListener('paste', function (e) {
    var text = (e.clipboardData || window.clipboardData).getData('text/plain')
    if (!text) return
    e.preventDefault()
    document.execCommand('insertText', false, text.replace(/\s*\n\s*/g, ' ').trim())
    onEdit()
  })

  /* ---------- 工具栏（execCommand 作用于排版面选区） ---------- */

  function cmdFocus() {
    ;(lastFocusFlow || els.flow).focus()
  }

  // 标题流只支持行内格式：块级命令会把 h0 换成别的标签，导出时标题就丢了
  var BLOCK_CMDS = {
    h1: 1,
    h2: 1,
    h3: 1,
    p: 1,
    blockquote: 1,
    insertUnorderedList: 1,
    insertOrderedList: 1,
    insertHorizontalRule: 1,
    indent: 1,
    outdent: 1
  }

  /* ---------- 缩进：顶层块 margin-left，步长＝2 倍字号（中文两字缩进），与 px 设置同量纲 ---------- */

  function selectedBlocks(flow) {
    var sel = window.getSelection()
    if (!sel || !sel.rangeCount || !flow.contains(sel.anchorNode)) return []
    var range = sel.getRangeAt(0)
    var hit = Array.prototype.filter.call(flow.children, function (n) {
      return range.intersectsNode(n)
    })
    if (hit.length) return hit
    var n = range.startContainer // 折叠光标：取光标所在顶层块
    while (n.parentNode && n.parentNode !== flow) n = n.parentNode
    return n.parentNode === flow ? [n] : []
  }

  function shiftIndent(dir) {
    var step = Math.round(state.typo.bodySize * 2)
    selectedBlocks(lastFocusFlow || els.flow).forEach(function (b) {
      var v = Math.max(0, (parseFloat(b.style.marginLeft) || 0) + dir * step)
      b.style.marginLeft = v ? v + 'px' : ''
    })
  }

  var TOOLS = {
    indent: function () {
      shiftIndent(1)
    },
    outdent: function () {
      shiftIndent(-1)
    },
    h1: function () {
      document.execCommand('formatBlock', false, 'H1')
    },
    h2: function () {
      document.execCommand('formatBlock', false, 'H2')
    },
    h3: function () {
      document.execCommand('formatBlock', false, 'H3')
    },
    p: function () {
      document.execCommand('formatBlock', false, 'P')
    },
    blockquote: function () {
      document.execCommand('formatBlock', false, 'BLOCKQUOTE')
    },
    link: function () {
      var sel = window.getSelection()
      var url = prompt('链接地址：', 'https://')
      if (!url) return
      if (sel && sel.toString()) document.execCommand('createLink', false, url)
      else document.execCommand('insertHTML', false, '<a href="' + RENDER.esc(url) + '">' + RENDER.esc(url) + '</a>&nbsp;')
    },
    image: function () {
      var url = prompt('图片地址（外链需允许跨域访问）：', 'https://')
      if (!url) return
      document.execCommand('insertHTML', false, '<img src="' + RENDER.esc(url) + '" alt="">')
    },
    openFile: function () {
      $('fileInput').click()
    }
  }

  $('mdTools').addEventListener('mousedown', function (e) {
    if (e.target.closest('button')) e.preventDefault() // 保住排版面选区
  })

  $('mdTools').addEventListener('click', function (e) {
    var btn = e.target.closest('button[data-cmd]')
    if (!btn) return
    var cmd = btn.dataset.cmd
    var inTitle = (lastFocusFlow || els.flow) === els.titleFlow
    cmdFocus()
    if (inTitle && BLOCK_CMDS[cmd]) return
    if (TOOLS[cmd]) TOOLS[cmd]()
    else document.execCommand(cmd, false, null)
    onEdit()
  })

  $('importBtn').addEventListener('click', function () {
    TOOLS.openFile()
  })

  $('fileInput').addEventListener('change', function (e) {
    var f = e.target.files && e.target.files[0]
    if (!f) return
    var r = new FileReader()
    r.onload = function () {
      var html = RENDER.blocksToHtml(MD.parse(String(r.result)))
      els.flow.focus()
      document.execCommand('insertHTML', false, html)
      onEdit()
    }
    r.readAsText(f, 'utf-8')
    e.target.value = ''
  })

  /* ---------- 排版参数输入（px，change 即生效并预览） ---------- */

  function typoInputs() {
    return Array.prototype.slice.call(document.querySelectorAll('#mdTools input[type="number"]'))
  }

  function valueOf(inp) {
    if (inp.dataset.typo) return state.typo[inp.dataset.typo]
    return state.typo.marginsPx[+inp.dataset.margin]
  }

  function writeTypo(inp, v) {
    if (inp.dataset.typo) state.typo[inp.dataset.typo] = v
    else state.typo.marginsPx[+inp.dataset.margin] = v
  }

  function fillTypo() {
    typoInputs().forEach(function (inp) {
      inp.value = valueOf(inp)
    })
  }

  function bindTypo() {
    typoInputs().forEach(function (inp) {
      var lim = inp.dataset.typo ? TYPO_LIMITS[inp.dataset.typo] : MARGIN_LIMIT
      inp.min = lim.min
      inp.max = lim.max
      inp.step = lim.step
      inp.value = valueOf(inp)
      inp.title = '范围 ' + lim.min + '~' + lim.max + 'px'
      inp.addEventListener('change', function () {
        var v = clamp(inp.value, lim)
        if (v === null) {
          fillTypo()
          return
        }
        writeTypo(inp, v)
        inp.value = v
        applyCanvas()
        onEdit()
      })
    })
  }

  $('typoReset').addEventListener('click', function () {
    state.typo = RENDER.defaultTypo()
    fillTypo()
    applyCanvas()
    onEdit()
  })

  /* ---------- 选项 ---------- */

  function bindRadios(name, key, after) {
    document.querySelectorAll('input[name="' + name + '"]').forEach(function (r) {
      r.checked = String(state[key]) === r.value
      r.addEventListener('change', function () {
        if (!r.checked) return
        state[key] = r.value
        if (after) after()
        onEdit()
      })
    })
  }

  bindRadios('expMode', 'mode', function () {
    document.body.classList.toggle('mode-chapter', state.mode === 'chapter')
    scheduleScale()
  })
  bindRadios('expFmt', 'fmt')
  bindRadios('expQuality', 'quality', function () {
    els.qualityHint.textContent = QUALITY_HINTS[state.quality]
    syncFmtEnabled()
  })

  function syncFmtEnabled() {
    var forced = state.quality === 'compressed'
    document.querySelectorAll('input[name="expFmt"]').forEach(function (r) {
      r.disabled = forced
    })
  }

  window.addEventListener('resize', applyScale)

  /* ---------- 导出 ---------- */

  els.exportBtn.addEventListener('click', function () {
    if (els.exportBtn.disabled) return
    var blocks = docBlocks()
    var named = titleText() && titleText() !== UNTITLED
    if (!blocks.length && !named) {
      els.exportHint.className = 'err'
      els.exportHint.textContent = '左侧还没有内容，先输入或粘贴一些文字。'
      return
    }
    els.exportBtn.disabled = true
    els.exportHint.className = ''
    els.exportHint.textContent = '准备中…'

    var targets
    try {
      targets = buildTargets()
    } catch (e) {
      finishExport('生成导出内容失败：' + e.message)
      return
    }

    EXPORT.runExport(targets, {
      quality: state.quality,
      format: state.fmt,
      zipName: baseName() + '-章节长图',
      onStep: function (i, n) {
        els.exportHint.textContent = '正在渲染第 ' + i + '/' + n + ' 张…'
      },
      onProgress: function (imgIdx, imgTotal, done, total) {
        if (imgTotal > 1) {
          els.exportHint.textContent =
            '第 ' + imgIdx + '/' + imgTotal + ' 张 · 高度 ' + Math.round((done / total) * 100) + '%'
        }
      }
    })
      .then(function (r) {
        var msg = '已导出 ' + r.files.length + ' 张 · 共 ' + EXPORT.formatBytes(r.zipSize || r.totalBytes)
        if (r.files.length > 1) {
          var detail = r.files
            .map(function (f) {
              return f.name.replace(/^.*?-长图-?/, '').replace(/\.\w+$/, '') + ' ' + EXPORT.formatBytes(f.size)
            })
            .join('，')
          msg += '（' + detail + '）'
        }
        finishExport(msg)
      })
      .catch(function (e) {
        finishExport('导出失败：' + (e && e.message ? e.message : e) + '（外链图片需允许跨域访问）')
      })
  })

  function finishExport(msg) {
    els.exportHint.className = /失败/.test(msg) ? 'err' : ''
    els.exportHint.textContent = msg
    els.exportBtn.disabled = false
  }

  /* ---------- 操作区折叠（仅手机端；进入页面默认收起，滚动不改变状态） ---------- */

  function bindCollapse(bodyClass, toggleId, label) {
    var btn = $(toggleId)
    btn.addEventListener('click', function () {
      var collapsed = document.body.classList.toggle(bodyClass)
      btn.textContent = label + (collapsed ? ' ▸' : ' ▾')
      btn.setAttribute('aria-expanded', String(!collapsed))
      if (bodyClass === 'exp-collapsed' || bodyClass === 'tools-collapsed') scheduleScale()
      if (bodyClass === 'tools-collapsed') fitPanels()
    })
  }

  /* ---------- 格式区分页（基本 / 排版）：页签切换即左右翻页 ---------- */

  var toolPanel = 'basic'

  // 卡片折叠时（display:none）量不到高度，直接跳过，别把 height 写成 0
  function fitPanels() {
    var box = els.panels
    if (!box.offsetParent) return
    box.style.height = $(toolPanel === 'typo' ? 'panelTypo' : 'panelBasic').offsetHeight + 'px'
  }

  function showPanel(name) {
    toolPanel = name
    els.mdTools.classList.toggle('panel-typo', name === 'typo')
    Array.prototype.forEach.call(els.mdTools.querySelectorAll('.tool-tabs .tab'), function (t) {
      var on = t.dataset.panel === name
      t.classList.toggle('on', on)
      t.setAttribute('aria-selected', String(on))
    })
    fitPanels()
  }

  Array.prototype.forEach.call(els.mdTools.querySelectorAll('.tool-tabs .tab'), function (t) {
    t.addEventListener('click', function () {
      showPanel(t.dataset.panel)
    })
  })

  window.addEventListener('resize', fitPanels)

  bindCollapse('tools-collapsed', 'toolsToggle', '格式')
  bindCollapse('exp-collapsed', 'expToggle', '导出')

  /* ---------- 启动 ---------- */

  initContent()
  if (isMobile()) {
    document.body.classList.add('tools-collapsed', 'exp-collapsed')
    $('toolsToggle').textContent = '格式 ▸'
    $('toolsToggle').setAttribute('aria-expanded', 'false')
    $('expToggle').textContent = '导出 ▸'
    $('expToggle').setAttribute('aria-expanded', 'false')
  }
  MQ_MOBILE.addEventListener('change', scheduleScale)
  bindTypo()
  applyCanvas()
  els.qualityHint.textContent = QUALITY_HINTS[state.quality]
  syncFmtEnabled()
  updateStats()
  fitPanels()
  RENDER.settle(els.flow).then(function () {
    fitPanels()
    updateEstimate()
  })
})()
