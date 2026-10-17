/**
 * 模式表：带插值的文案按形状认。
 * ------------------------------------------------------------------
 * 上游有大量文案是模板串拼出来的（`Open ${name}`、`${n} slides`），
 * 永远不可能成为词典的键，只能按形状认。
 *
 * 每条都是**锚定正则**（`^…$`，不带 `g`）。替换函数返回**空串**表示
 * 「这条不适用」，让文案保持英文并出现在缺口报告里——宁可半句英文，
 * 也别拼出「重置 Reset all」这种半成品。
 *
 * 捕获组若是界面文案（控件名、分类名）就递归再翻一次；若是用户数据
 * （文档名、文件名）就原样保留。
 *
 * 本项目的这些插值文案绝大部分来自 SheetJS 与 OOXML 解析层，捕获组是
 * 类型名 / 十六进制偏移 / 标识符这类**技术值**，一律原样保留，不递归翻译。
 */
export const patterns = [
  [/^Unrecognized type (.+)$/, (m) => `无法识别的类型 ${m[1]}`],
  [/^Unexpected record 0x(.+)$/, (m) => `意外的记录 0x${m[1]}`],
  [/^unrecognized (.+)$/, (m) => `无法识别的 ${m[1]}`],
  [/^Bad state: (.+)$/, (m) => `状态错误：${m[1]}`],
  [/^ECMA-376 Encrypted file missing (.+)$/, (m) => `ECMA-376 加密文件缺少 ${m[1]}`],
  [/^ECMA-376 Encrypted file bad (.+)$/, (m) => `ECMA-376 加密文件的 ${m[1]} 无效`],
  [/^Range (.+)$/, (m) => `区域 ${m[1]}`],
  [/^Unsupported cell type (.+)$/, (m) => `不支持的单元格类型 ${m[1]}`],
  [/^SYLK bad record (.+)$/, (m) => `SYLK 记录无效：${m[1]}`],
  [/^Unexpected PtgAttrSpaceType (.+)$/, (m) => `意外的 PtgAttrSpaceType ${m[1]}`],
  [/^FAT boundary crossed: (.+)$/, (m) => `跨越 FAT 边界：${m[1]}`],
  [/^invalid type (.+)$/, (m) => `类型无效：${m[1]}`],
  [/^Sheet not found: (.+)$/, (m) => `找不到工作表：${m[1]}`],
  [/^TypedPropertyValue unrecognized type (.+)$/, (m) => `TypedPropertyValue 无法识别的类型 ${m[1]}`],
  [/^Unknown Namespace: (.+)$/, (m) => `未知命名空间：${m[1]}`],
  [/^unrecognized character (.+)$/, (m) => `无法识别的字符 ${m[1]}`],
  [/^Unrecognized Formula Token: (.+)$/, (m) => `无法识别的公式词元：${m[1]}`],
];
