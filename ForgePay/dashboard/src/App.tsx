import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { Layout } from './components/Layout'
import { Dashboard } from './pages/Dashboard'
import { Products } from './pages/Products'
import { Customers } from './pages/Customers'
import { Webhooks } from './pages/Webhooks'
import { AuditLogs } from './pages/AuditLogs'
import { LegalTemplates } from './pages/LegalTemplates'
import { Login } from './pages/Login'
import { PortalLogin } from './pages/portal/PortalLogin'
import { PortalDashboard } from './pages/portal/PortalDashboard'
import { PortalVerify } from './pages/portal/PortalVerify'
import { useAuth } from './hooks/useAuth'

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isLoading } = useAuth()

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
      </div>
    )
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />
  }

  return <>{children}</>
}

function App() {
  return (
    <BrowserRouter>
      <Routes>
        {/* Admin Login */}
        <Route path="/login" element={<Login />} />
        
        {/* Customer Portal Routes */}
        <Route path="/customer/login" element={<PortalLogin />} />
        <Route path="/customer/verify" element={<PortalVerify />} />
        <Route path="/customer" element={<PortalDashboard />} />
        
        {/* Redirect /portal to /customer for API compatibility */}
        <Route path="/portal/auth/verify" element={<PortalVerify />} />
        
        {/* Admin Dashboard Routes */}
        <Route
          path="/*"
          element={
            <ProtectedRoute>
              <Layout>
                <Routes>
                  <Route path="/" element={<Dashboard />} />
                  <Route path="/products" element={<Products />} />
                  <Route path="/customers" element={<Customers />} />
                  <Route path="/webhooks" element={<Webhooks />} />
                  <Route path="/audit-logs" element={<AuditLogs />} />
                  <Route path="/legal" element={<LegalTemplates />} />
                </Routes>
              </Layout>
            </ProtectedRoute>
          }
        />
      </Routes>
    </BrowserRouter>
  )
}

export default App
