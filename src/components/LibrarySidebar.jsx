import {
  Archive,
  Bell,
  BookCopy,
  BookOpen,
  Check,
  Download,
  ExternalLink,
  Images,
  LibraryBig,
  MoveRight,
  QrCode,
  Smartphone,
  Sparkles,
} from "lucide-react";

import {
  CATEGORY_OPTIONS as categoryOptions,
  PLATFORM_CATALOG as platformCatalog,
} from "../library-model.js";

/**
 * 表示切替・絞り込み・取り込み・iPhone連携をまとめた左サイドバー。
 *
 * @param {object} props 集計値・現在の表示状態・操作。
 * @param {number} props.bookCount 全蔵書数。
 * @param {number} props.physicalCount 実本数。
 * @param {number} props.electronicCount 電子書籍数。
 * @param {Record<string, number>} props.categoryCounts カテゴリ別冊数。
 * @param {Record<string, number>} props.platformCounts 電子媒体別冊数。
 * @param {string} props.viewMode 現在の表示モード。
 * @param {import("../hooks/use-library-filters.js").LibraryFilters} props.filters 絞り込み状態。
 * @param {boolean} props.hasFilters 絞り込みが適用されているか。
 * @param {number} props.seriesUpdateCount 新刊候補シリーズ数。
 * @param {number} props.dueReminderCount 期限到来リマインダー数。
 * @param {boolean} props.serverOnline サーバー接続状態。
 * @param {object|null} props.config /api/configの応答。
 * @returns {import("react").ReactElement} サイドバー。
 */
export function LibrarySidebar({
  bookCount,
  physicalCount,
  electronicCount,
  categoryCounts,
  platformCounts,
  viewMode,
  filters,
  hasFilters,
  seriesUpdateCount,
  dueReminderCount,
  serverOnline,
  config,
  onResetFilters,
  onShowNewReleases,
  onShowReminders,
  onOpenRecommendations,
  onChooseOwnership,
  onChoosePlatform,
  onChooseCategory,
  onOpenBulkImport,
  onOpenUploadPage,
  onOpenCheckPage,
}) {
  const inLibrary = viewMode === "library";
  return (
    <aside className="sidebar">
      <div className="brand">
        <BookOpen size={28} />
        <div><strong>本棚カタログ</strong><span>蔵書管理</span></div>
      </div>
      <nav className="sidebar-nav" aria-label="本棚の絞り込み">
        <span className="nav-section-title">表示</span>
        <button className={inLibrary && !hasFilters ? "active" : ""} onClick={onResetFilters} title="すべての本">
          <LibraryBig size={19} /><span>すべての本</span><b>{bookCount}</b>
        </button>
        <button className={viewMode === "new-releases" ? "active" : ""} onClick={onShowNewReleases} title="新刊リスト">
          <BookCopy size={19} /><span>新刊リスト</span>
          {seriesUpdateCount > 0 && <b className="attention-count">{seriesUpdateCount}</b>}
        </button>
        <button className={viewMode === "reminders" ? "active" : ""} onClick={onShowReminders} title="リマインダー">
          <Bell size={19} /><span>リマインダー</span>
          {dueReminderCount > 0 && <b className="attention-count">{dueReminderCount}</b>}
        </button>
        <button className={viewMode === "recommendations" ? "active" : ""} onClick={onOpenRecommendations} title="本のパック">
          <Sparkles size={19} /><span>本のパック</span>
        </button>

        <span className="nav-section-title">所有形態</span>
        <button
          className={inLibrary && filters.ownershipFilter === "physical" ? "active" : ""}
          onClick={() => onChooseOwnership("physical")}
          title="実本"
        >
          <Archive size={19} /><span>実本</span><b>{physicalCount}</b>
        </button>
        <button
          className={inLibrary && filters.ownershipFilter === "electronic" && filters.platformFilter === "all" ? "active" : ""}
          onClick={() => onChooseOwnership("electronic")}
          title="電子書籍"
        >
          <Smartphone size={19} /><span>電子書籍</span><b>{electronicCount}</b>
        </button>
        {platformCatalog.filter((platform) => platform.featured || platformCounts[platform.name] > 0).map((platform) => (
          <div className="platform-nav-row" key={platform.name}>
            <button
              className={`subnav-button ${inLibrary && filters.platformFilter === platform.name ? "active" : ""}`}
              onClick={() => onChoosePlatform(platform.name)}
            >
              <span>{platform.name}</span><b>{platformCounts[platform.name] || 0}</b>
            </button>
            {platform.url && (
              <a aria-label={`${platform.name}公式サイトを開く`} href={platform.url} rel="noreferrer" target="_blank">
                <ExternalLink size={13} />
              </a>
            )}
          </div>
        ))}

        <span className="nav-section-title">取り込み</span>
        <button
          className="nav-import-button"
          disabled={!serverOnline}
          onClick={() => onOpenBulkImport("electronic")}
          title="電子書籍のスクリーンショットを取り込む"
        >
          <Images size={19} /><span>電子書籍を登録</span>
        </button>
        <button
          className="nav-import-button"
          disabled={!serverOnline}
          onClick={() => onOpenBulkImport("physical")}
          title="実本をまとめて取り込む"
        >
          <Archive size={19} /><span>実本を取り込む</span>
        </button>

        <span className="nav-section-title">カテゴリ</span>
        {categoryOptions
          .filter((category) => categoryCounts[category] > 0 || category === "マンガ" || category === "小説")
          .map((category) => (
            <button
              className={inLibrary && filters.categoryFilter === category ? "active" : ""}
              key={category}
              onClick={() => onChooseCategory(category)}
              title={category}
            >
              <BookOpen size={18} /><span>{category}</span><b>{categoryCounts[category] || 0}</b>
            </button>
          ))}
      </nav>
      <section className="lan-card" aria-label="LAN upload">
        <div><strong>iPhone連携</strong><span>本の追加と、店頭へ持ち出す蔵書データの同期</span></div>
        <div className="qr-tile">
          {config?.qrCode ? <img src={config.qrCode} alt="iPhoneアップロード用QRコード" /> : <QrCode size={70} />}
        </div>
        <code>{config?.uploadUrl || "サーバー接続を確認中..."}</code>
        <button disabled={!config} onClick={onOpenUploadPage}>本を追加 <MoveRight size={16} /></button>
        <button disabled={!config} onClick={onOpenCheckPage}><Check size={16} />買う前チェック</button>
        {serverOnline && (
          <a className="export-link" href="/api/export/books" download>
            <Download size={14} />蔵書データを書き出す
          </a>
        )}
      </section>
    </aside>
  );
}
