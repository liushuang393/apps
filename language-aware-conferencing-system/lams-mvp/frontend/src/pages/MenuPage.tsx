/**
 * メニューページ
 * ログイン後のメイン画面 - 各機能へのナビゲーション
 */
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuthStore } from '../store/authStore';
import { LANGUAGE_DISPLAY_NAMES, SUPPORTED_LANGUAGES, type UILanguage } from '../i18n';

/** メニュー項目の型定義 */
interface MenuItem {
  icon: string;
  titleKey: string;
  descKey: string;
  path: string;
  badge?: string;
  badgeKey?: string;
}

/** メニュー項目の型定義（拡張） */
interface MenuItemExtended extends MenuItem {
  requireAdmin?: boolean;
}

/** メニューカテゴリの型定義（拡張） */
interface MenuCategoryExtended {
  titleKey: string;
  icon: string;
  items: MenuItemExtended[];
}

/** メニューカテゴリ定義（i18nキーを使用） */
const menuCategories: MenuCategoryExtended[] = [
  {
    titleKey: 'menu.communication',
    icon: '💬',
    items: [
      {
        icon: '🌐',
        titleKey: 'menu.multiLangMeeting',
        descKey: 'menu.multiLangMeetingDesc',
        path: '/rooms',
        badge: 'LAMS',
      },
    ],
  },
  {
    titleKey: 'menu.management',
    icon: '⚙️',
    items: [
      {
        icon: '👤',
        titleKey: 'menu.profile',
        descKey: 'menu.profileDesc',
        path: '/profile',
        badgeKey: 'menu.comingSoon',
      },
      {
        icon: '📊',
        titleKey: 'menu.history',
        descKey: 'menu.historyDesc',
        path: '/history',
        badgeKey: 'menu.comingSoon',
      },
      {
        icon: '🔧',
        titleKey: 'menu.admin',
        descKey: 'menu.adminDesc',
        path: '/admin',
        requireAdmin: true,
      },
    ],
  },
];

export function MenuPage() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const { user, logout } = useAuthStore();

  /** 言語切替処理 */
  const handleLanguageChange = (lang: UILanguage) => {
    i18n.changeLanguage(lang);
  };

  /** ログアウト処理 */
  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  /** 準備中かどうか判定 */
  const isComingSoon = (item: MenuItem) => !!item.badgeKey;

  /** 管理者権限チェック */
  const isAdmin = user?.role === 'admin';

  /** フィルタされたメニューカテゴリ（管理者専用項目を除外） */
  const filteredCategories = menuCategories.map((category) => ({
    ...category,
    items: category.items.filter((item) => !item.requireAdmin || isAdmin),
  })).filter((category) => category.items.length > 0);

  return (
    <div className="menu-page">
      {/* ヘッダー */}
      <header className="menu-header">
        <div className="header-left">
          <h1>🌐 {t('app.title')}</h1>
          <span className="header-subtitle">{t('app.portal')}</span>
        </div>
        <div className="header-right">
          {/* 言語切替セレクター */}
          <select
            className="language-selector"
            value={i18n.language}
            onChange={(e) => handleLanguageChange(e.target.value as UILanguage)}
          >
            {SUPPORTED_LANGUAGES.map((lang) => (
              <option key={lang} value={lang}>
                {LANGUAGE_DISPLAY_NAMES[lang]}
              </option>
            ))}
          </select>
          <div className="user-info">
            <span className="user-avatar">{user?.displayName?.charAt(0) || '?'}</span>
          </div>
          <button className="btn-logout" onClick={handleLogout}>
            {t('common.logout')}
          </button>
        </div>
      </header>

      {/* メインコンテンツ */}
      <main className="menu-content">
        <div className="menu-grid">
          {filteredCategories.map((category) => (
            <section key={category.titleKey} className="menu-category">
              <h2 className="category-title">
                <span className="category-icon">{category.icon}</span>
                {t(category.titleKey)}
              </h2>
              <div className="menu-items">
                {category.items.map((item) => (
                  <Link
                    key={item.path}
                    to={isComingSoon(item) ? '#' : item.path}
                    className={`menu-item ${isComingSoon(item) ? 'disabled' : ''}`}
                    onClick={(e) => {
                      if (isComingSoon(item)) {
                        e.preventDefault();
                      }
                    }}
                  >
                    <div className="item-icon">{item.icon}</div>
                    <div className="item-content">
                      <h3 className="item-title">
                        {t(item.titleKey)}
                        {(item.badge || item.badgeKey) && (
                          <span className={`item-badge ${item.badgeKey ? 'coming-soon' : ''}`}>
                            {item.badge || t(item.badgeKey!)}
                          </span>
                        )}
                      </h3>
                      <p className="item-description">{t(item.descKey)}</p>
                    </div>
                    <div className="item-arrow">→</div>
                  </Link>
                ))}
              </div>
            </section>
          ))}
        </div>
      </main>

      {/* フッター */}
      <footer className="menu-footer">
        <p>{t('app.copyright')}</p>
      </footer>
    </div>
  );
}

