/**
 * プロジェクトをタブのセッション中（閉じるまで）だけ保持する自動保存。
 *
 * サーバーへは何も送らず、sessionStorage に .chrd と同じ JSON 形式で書くだけ。
 * リロードのたびにデフォルトのコード進行へ戻ってしまうのを防ぐのが目的で、
 * ブラウザやタブを閉じれば消える（永続化したい場合は通常の保存(.chrd)を使う）。
 */
import {
  parseProjectFile,
  serializeProject,
  type ProjectFile,
  type ProjectFileSource,
} from './projectFile';

const AUTOSAVE_KEY = 'chrodmaker:autosave';

/** 壊れている・存在しない場合は null を返し、既定値へフォールバックさせる */
export function loadAutosave(): ProjectFile | null {
  try {
    const raw = sessionStorage.getItem(AUTOSAVE_KEY);
    if (!raw) return null;
    return parseProjectFile(raw);
  } catch {
    return null;
  }
}

export function saveAutosave(source: ProjectFileSource): void {
  try {
    sessionStorage.setItem(AUTOSAVE_KEY, JSON.stringify(serializeProject(source)));
  } catch {
    // 容量超過などが起きても致命的ではないので無視する
  }
}
