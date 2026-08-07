/**
 * yaml 模块声明 — next.config.ts 通过 webpack rule { test: /\.yaml$/, type: 'asset/source' }
 * 让 .yaml 文件以 string 形式 default-export 进来。
 *
 * 见 src/lib/dict-yaml.ts 的使用。
 */
declare module '*.yaml' {
  const content: string;
  export default content;
}