/**
 * Sonowa アプリケーションルート
 */
import './styles/main.css';
import { lazy, Suspense, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { BrowserRouter, Routes, Route, Navigate, useNavigate } from 'react-router-dom';
import { useAuthStore } from './store/authStore';
import { ApiError, authApi } from './api/client';
import { LoginPage } from './pages/LoginPage';
import { MenuPage } from './pages/MenuPage';

/*
 * ページの遅延読込（初期バンドル削減）
 * ログイン・メニューは初期表示/認証リダイレクト先のため同期読込のまま。
 * ページは named export のため default に詰め替える。
 */
const RegisterPage = lazy(() => import('./pages/RegisterPage').then((m) => ({ default: m.RegisterPage })));
const ForgotPasswordPage = lazy(() => import('./pages/ForgotPasswordPage').then((m) => ({ default: m.ForgotPasswordPage })));
const ResetPasswordPage = lazy(() => import('./pages/ResetPasswordPage').then((m) => ({ default: m.ResetPasswordPage })));
const RoomListPage = lazy(() => import('./pages/RoomListPage').then((m) => ({ default: m.RoomListPage })));
const RoomPage = lazy(() => import('./pages/RoomPage').then((m) => ({ default: m.RoomPage })));
const TranscriptPage = lazy(() => import('./pages/TranscriptPage').then((m) => ({ default: m.TranscriptPage })));
const AdminPage = lazy(() => import('./pages/AdminPage').then((m) => ({ default: m.AdminPage })));
const LanguageSettingsPage = lazy(() => import('./pages/LanguageSettingsPage').then((m) => ({ default: m.LanguageSettingsPage })));
const AiPipelineSettingsPage = lazy(() => import('./pages/AiPipelineSettingsPage').then((m) => ({ default: m.AiPipelineSettingsPage })));
const ExperimentsPage = lazy(() => import('./pages/ExperimentsPage').then((m) => ({ default: m.ExperimentsPage })));
const ProfilePage = lazy(() => import('./pages/ProfilePage').then((m) => ({ default: m.ProfilePage })));
const HistoryPage = lazy(() => import('./pages/HistoryPage').then((m) => ({ default: m.HistoryPage })));
const GlossaryPage = lazy(() => import('./pages/GlossaryPage').then((m) => ({ default: m.GlossaryPage })));

/** 遅延読込中の表示（既存ページの読込中表示と同じスタイル） */
function PageLoading() {
  const { t } = useTranslation();
  return (
    <div className="empty-state">
      <p>{t('common.loading')}</p>
    </div>
  );
}

/**
 * アプリ起動時にトークン有効性をバックエンドで検証するコンポーネント
 *
 * 目的: localStorage の isAuthenticated が true でも、
 *       トークン期限切れ・無効な場合は即座に logout してログイン画面へ誘導する。
 * 注意: BrowserRouter の内側で使用すること（useNavigate を利用するため）
 */
function AuthValidator({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, hasHydrated, logout } = useAuthStore();
  const navigate = useNavigate();
  // トークン検証が完了したかを示すフラグ（未ログイン時は即完了扱い）
  const [tokenChecked, setTokenChecked] = useState(false);

  useEffect(() => {
    // hydration 完了前は待機
    if (!hasHydrated) return;

    // 未ログイン状態はそのまま通す（/login へのルーティングは PrivateRoute が担当）
    if (!isAuthenticated) {
      setTokenChecked(true);
      return;
    }

    // バックエンドで JWT の有効性を検証
    authApi.me()
      .then(() => {
        setTokenChecked(true);
      })
      .catch((err: unknown) => {
        // ネットワーク断・5xx はセッションを保持する（backend 再起動中の誤ログアウト防止）
        if (!(err instanceof ApiError && err.status === 401)) {
          setTokenChecked(true);
          return;
        }
        // 期限切れ・無効トークン: 認証状態をクリアしてログイン画面へ
        logout();
        setTokenChecked(true);
        navigate('/login', { replace: true });
      });
  // hasHydrated が true になった瞬間に1回だけ実行
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasHydrated]);

  // hydration 待ち or トークン検証中は何も表示しない
  if (!hasHydrated || !tokenChecked) {
    return null;
  }

  return <>{children}</>;
}

/** 認証必須ルート（AuthValidator 完了後に評価されるため二重チェック不要） */
function PrivateRoute({ children }: { children: React.ReactNode }) {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const hasHydrated = useAuthStore((s) => s.hasHydrated);
  if (!hasHydrated) {
    return null;
  }
  return isAuthenticated ? <>{children}</> : <Navigate to="/login" replace />;
}

function AdminRoute({ children }: { children: React.ReactNode }) {
  const user = useAuthStore((s) => s.user);
  const hasHydrated = useAuthStore((s) => s.hasHydrated);
  if (!hasHydrated) {
    return null;
  }
  if (user?.role !== 'admin') {
    return <Navigate to="/menu" replace />;
  }
  return <>{children}</>;
}

export function App() {
  return (
    <BrowserRouter>
      <AuthValidator>
      <Suspense fallback={<PageLoading />}>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />
        <Route path="/forgot-password" element={<ForgotPasswordPage />} />
        <Route path="/reset-password" element={<ResetPasswordPage />} />
        <Route
          path="/menu"
          element={
            <PrivateRoute>
              <MenuPage />
            </PrivateRoute>
          }
        />
        <Route
          path="/profile"
          element={
            <PrivateRoute>
              <ProfilePage />
            </PrivateRoute>
          }
        />
        <Route
          path="/history"
          element={
            <PrivateRoute>
              <HistoryPage />
            </PrivateRoute>
          }
        />
        <Route
          path="/rooms"
          element={
            <PrivateRoute>
              <RoomListPage />
            </PrivateRoute>
          }
        />
        <Route
          path="/room/:roomId"
          element={
            <PrivateRoute>
              <RoomPage />
            </PrivateRoute>
          }
        />
        <Route
          path="/room/:roomId/transcript"
          element={
            <PrivateRoute>
              <TranscriptPage />
            </PrivateRoute>
          }
        />
        <Route
          path="/admin"
          element={
            <PrivateRoute>
              <AdminRoute>
                <AdminPage />
              </AdminRoute>
            </PrivateRoute>
          }
        />
        <Route
          path="/admin/languages"
          element={
            <PrivateRoute>
              <AdminRoute>
                <LanguageSettingsPage />
              </AdminRoute>
            </PrivateRoute>
          }
        />
        <Route
          path="/admin/ai-pipeline"
          element={
            <PrivateRoute>
              <AdminRoute>
                <AiPipelineSettingsPage />
              </AdminRoute>
            </PrivateRoute>
          }
        />
        <Route
          path="/admin/experiments"
          element={
            <PrivateRoute>
              <AdminRoute>
                <ExperimentsPage />
              </AdminRoute>
            </PrivateRoute>
          }
        />
        <Route
          path="/admin/glossary"
          element={
            <PrivateRoute>
              <AdminRoute>
                <GlossaryPage />
              </AdminRoute>
            </PrivateRoute>
          }
        />
        <Route path="/" element={<Navigate to="/menu" />} />
      </Routes>
      </Suspense>
      </AuthValidator>
    </BrowserRouter>
  );
}
