/**
 * LAMS アプリケーションルート
 */
import { useEffect, useState } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useNavigate } from 'react-router-dom';
import { useAuthStore } from './store/authStore';
import { authApi } from './api/client';
import { LoginPage } from './pages/LoginPage';
import { RegisterPage } from './pages/RegisterPage';
import { ForgotPasswordPage } from './pages/ForgotPasswordPage';
import { ResetPasswordPage } from './pages/ResetPasswordPage';
import { MenuPage } from './pages/MenuPage';
import { RoomListPage } from './pages/RoomListPage';
import { RoomPage } from './pages/RoomPage';
import { TranscriptPage } from './pages/TranscriptPage';
import { AdminPage } from './pages/AdminPage';
import { LanguageSettingsPage } from './pages/LanguageSettingsPage';
import './styles/main.css';

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
      .catch(() => {
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

export function App() {
  return (
    <BrowserRouter>
      <AuthValidator>
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
              <AdminPage />
            </PrivateRoute>
          }
        />
        <Route
          path="/admin/languages"
          element={
            <PrivateRoute>
              <LanguageSettingsPage />
            </PrivateRoute>
          }
        />
        <Route path="/" element={<Navigate to="/menu" />} />
      </Routes>
      </AuthValidator>
    </BrowserRouter>
  );
}
