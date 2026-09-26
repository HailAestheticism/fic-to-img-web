/* 轻量 Markdown 解析：行内标记 + 块级结构 + H1 分章。规则与桌面版 importer.ts 对齐并按静态页需要扩展（保留 1-6 级标题、链接、图片；行内代码已按需求移除）。 */
;(function (global) {
  'use strict'

  var INLINE_SRC =
    '!\\[([^\\]]*)\\]\\(([^)\\s]+)\\)|\\[([^\\]]+)\\]\\(([^)\\s]+)\\)|(\\*\\*|__)(?=\\S)([\\s\\S]*?\\S)\\5|~~(?=\\S)([\\s\\S]*?\\S)~~|\\*(?=\\S)([\\s\\S]*?\\S)\\*|(?<![\\w_])_(?=\\S)([\\s\\S]*?\\S)_(?![\\w_])|<(https?:\\/\\/[^>\\s]+)>'

  function safeUrl(u) {
    if (/^(https?:\/\/|mailto:|#|\/)/i.test(u)) return u
    if (/^data:image\/(png|jpe?g|gif|webp|svg\+xml);/i.test(u)) return u
    return '#'
  }

  function inline(s) {
    // 每次新建实例：共享全局正则会被递归解析重置 lastIndex，导致死循环
    var re = new RegExp(INLINE_SRC, 'g')
    var out = []
    var last = 0
    var m
    while ((m = re.exec(s))) {
      if (m.index > last) out.push({ t: 'text', v: s.slice(last, m.index) })
      if (m[2] !== undefined) out.push({ t: 'img', src: safeUrl(m[2]), alt: m[1] })
      else if (m[4] !== undefined) out.push({ t: 'a', href: safeUrl(m[4]), v: inline(m[3]) })
      else if (m[6] !== undefined) out.push({ t: 'b', v: inline(m[6]) })
      else if (m[7] !== undefined) out.push({ t: 's', v: inline(m[7]) })
      else if (m[8] !== undefined) out.push({ t: 'i', v: inline(m[8]) })
      else if (m[9] !== undefined) out.push({ t: 'i', v: inline(m[9]) })
      else if (m[10] !== undefined) out.push({ t: 'a', href: safeUrl(m[10]), v: [{ t: 'text', v: m[10] }] })
      last = re.lastIndex
    }
    if (last < s.length) out.push({ t: 'text', v: s.slice(last) })
    return out.length ? out : s ? [{ t: 'text', v: s }] : []
  }

  /** md 文本 → 块序列 */
  function parse(src) {
    var lines = String(src).replace(/\r\n?/g, '\n').split('\n')
    var blocks = []
    var para = []
    function flushPara() {
      if (para.length) {
        blocks.push({ type: 'p', spans: inline(para.join('\n')) })
        para = []
      }
    }

    var i = 0
    while (i < lines.length) {
      var line = lines[i]

      if (/^```\w*\s*$/.test(line)) {
        flushPara()
        i++
        var code = []
        while (i < lines.length && !/^```\s*$/.test(lines[i])) {
          code.push(lines[i])
          i++
        }
        i++
        blocks.push({ type: 'code', text: code.join('\n') })
        continue
      }

      var h = line.match(/^(#{1,6})\s+(.*)/)
      if (h) {
        flushPara()
        blocks.push({ type: 'h', level: h[1].length, spans: inline(h[2]) })
        i++
        continue
      }

      if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
        flushPara()
        blocks.push({ type: 'hr' })
        i++
        continue
      }

      if (/^>\s?/.test(line)) {
        flushPara()
        var quoted = []
        while (i < lines.length && /^>\s?/.test(lines[i])) {
          quoted.push(lines[i].replace(/^>\s?/, ''))
          i++
        }
        blocks.push({ type: 'quote', text: quoted.join('\n') })
        continue
      }

      if (/^\s*[-*+]\s+/.test(line)) {
        flushPara()
        var items = []
        while (i < lines.length && /^\s*[-*+]\s+/.test(lines[i])) {
          items.push(lines[i].replace(/^\s*[-*+]\s+/, ''))
          i++
        }
        blocks.push({ type: 'ul', items: items.map(inline) })
        continue
      }

      if (/^\s*\d+[.)]\s+/.test(line)) {
        flushPara()
        var oitems = []
        while (i < lines.length && /^\s*\d+[.)]\s+/.test(lines[i])) {
          oitems.push(lines[i].replace(/^\s*\d+[.)]\s+/, ''))
          i++
        }
        blocks.push({ type: 'ol', items: oitems.map(inline) })
        continue
      }

      if (!line.trim()) {
        flushPara()
        i++
        continue
      }

      para.push(line)
      i++
    }
    flushPara()
    return blocks
  }

  global.MD = { parse: parse, inline: inline }
})(window)
