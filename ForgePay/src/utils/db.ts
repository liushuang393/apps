/**
 * データベースユーティリティ
 *
 * 各 Repository の UPDATE クエリ構築は同一パターンの繰り返しになるため、
 * このモジュールに共通化する。
 */

/**
 * 動的 UPDATE クエリの SET 句を構築する
 *
 * @param params    更新パラメータオブジェクト（undefined フィールドはスキップ）
 * @param columnMap TypeScript プロパティ名 → DB カラム名 のマッピング
 * @param startIndex プレースホルダー開始インデックス（デフォルト: 1）
 *
 * @example
 * const { sets, values, nextIndex } = buildUpdateSets(
 *   { name: 'foo', active: undefined },
 *   { name: 'name', active: 'active', updatedAt: 'updated_at' }
 * );
 * // sets: ["name = $1"]  values: ["foo"]  nextIndex: 2
 */
export function buildUpdateSets(
  params: Record<string, unknown>,
  columnMap: Record<string, string>,
  startIndex = 1
): { sets: string[]; values: unknown[]; nextIndex: number } {
  const sets: string[] = [];
  const values: unknown[] = [];
  let i = startIndex;

  for (const [key, column] of Object.entries(columnMap)) {
    if (key in params && params[key] !== undefined) {
      sets.push(`${column} = $${i++}`);
      values.push(params[key]);
    }
  }

  return { sets, values, nextIndex: i };
}
