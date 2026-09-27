/**
 * Sonowa フロントエンドエントリーポイント
 */
import ReactDOM from 'react-dom/client';
import { App } from './App';
import './i18n';
import { installStaleChunkReload } from './staleChunkReload';

installStaleChunkReload();
ReactDOM.createRoot(document.getElementById('root')!).render(<App />);
