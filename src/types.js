/**
 * アプリ内で扱う蔵書レコード。
 *
 * @typedef {object} Book
 * @property {string|number} id 一意な蔵書ID。旧データとの互換性のため数値も許容する。
 * @property {string} title 書名。
 * @property {string} titleReading 並び替え・棚見出しに使う書名の読み。
 * @property {string} author 著者名。
 * @property {string} authorReading 並び替え・棚見出しに使う著者名の読み。
 * @property {string} isbn 正規化済みISBN-13。手動登録では空文字の場合がある。
 * @property {string} publisher 出版社。
 * @property {string} published 出版日または出版年月の表示文字列。
 * @property {string} pages ページ数の表示文字列。
 * @property {string} category 分類カテゴリ。
 * @property {"book"|"manga"} bookType 旧データ互換用の書籍分類。
 * @property {"physical"|"electronic"} format 所有形態。
 * @property {string} physicalLocation 実本の保管場所。
 * @property {string} electronicPlatform 電子書籍の媒体名。
 * @property {string} electronicUrl 電子書籍ストア等のHTTPS URL。
 * @property {string} shelf 利用者定義の棚・分類。
 * @property {string[]} tags タグ一覧。
 * @property {"未読"|"読了"} status 読書状態。
 * @property {number} rating 0から5の評価。
 * @property {string} note メモ。
 * @property {string} seriesName シリーズ名。
 * @property {number|null} volumeNumber 所持巻数。
 * @property {string} reminderDate YYYY-MM-DD形式のリマインド日。
 * @property {string} reminderNote リマインド内容。
 * @property {string} coverUrl 表紙画像URL。
 * @property {number} sortOrder 手動並び順。
 * @property {string} createdAt ISO 8601形式の登録日時。
 * @property {string} updatedAt ISO 8601形式の更新日時。
 * @property {string} [coverSource] 表紙画像の取得元表示。
 * @property {string} [metadataSource] 書誌情報の取得元表示。
 * @property {string} [metadataCheckedAt] 表紙・読み補完を最後に試行したISO 8601日時。再試行間隔の判定に使う。
 * @property {string} [uploadedImageUrl] ISBN読み取りに使った元画像のアプリ内URL。
 * @property {string} [seriesCheckedAt] シリーズ刊行確認のISO 8601日時。
 * @property {number|null} [seriesLatestVolume] 確認済みの最新巻数。
 * @property {string} [seriesLatestIsbn] 最新巻のISBN-13。
 * @property {string} [seriesLatestPublished] 最新巻の刊行日表示。
 * @property {string} [seriesLatestTitle] 最新巻の書名。
 * @property {string} [seriesLatestUrl] 最新巻のNDL書誌ページURL。
 * @property {number|null} [nextVolumeNumber] 次に未所持の巻数。
 * @property {string} [nextVolumeIsbn] 次巻のISBN-13。
 * @property {string} [nextVolumePublished] 次巻の刊行日表示。
 * @property {string} [nextVolumeTitle] 次巻の書名。
 * @property {string} [nextVolumeUrl] 次巻のNDL書誌ページURL。
 * @property {string|null} [sprite] 旧UI互換のために保存している未使用フィールド。
 */

/**
 * ISBN画像の受信・解析状態を保持するレコード。
 *
 * @typedef {object} UploadRecord
 * @property {string} id アップロードID。
 * @property {string} originalName 表示用に無害化した元ファイル名。
 * @property {string} storedFilename サーバー生成の保存ファイル名。
 * @property {string} imageUrl 保存画像のアプリ内URL。
 * @property {"processing"|"needs_isbn"|"success"} status 処理状態。
 * @property {string} message 利用者向け状態メッセージ。
 * @property {string} createdAt ISO 8601形式の受信日時。
 * @property {string} [completedAt] ISO 8601形式の完了日時。
 * @property {string} [dismissedAt] ISO 8601形式の通知非表示日時。
 * @property {string} [isbn] 確定したISBN-13。
 * @property {string|number} [bookId] 登録・更新した蔵書ID。
 */

/**
 * 外部書誌APIをアプリ共通形式へ統合した結果。
 * descriptionは紹介文の表示専用で、蔵書レコードへは保存しない（noteへ反映済み）。
 *
 * @typedef {Partial<Book> & {metadataSource: string, tags: string[], description?: string}} BookMetadata
 */

/**
 * NDLから取得したシリーズの一巻。
 *
 * @typedef {object} SeriesVolume
 * @property {string} title 書名。
 * @property {number} volumeNumber 巻数。
 * @property {string} isbn ISBN-13。
 * @property {string} published 刊行日表示。
 * @property {string} url NDL書誌ページURL。
 */

/**
 * 巻ごとの蔵書をシリーズ単位へ集約した新刊リスト用データ。
 *
 * @typedef {object} SeriesGroup
 * @property {string} key シリーズ比較キー。
 * @property {string} seriesName シリーズ名。
 * @property {Book[]} books シリーズ内の所持巻。
 * @property {Book} representative 新刊情報を持つ代表巻。
 * @property {string} coverUrl 代表巻の表紙URL。
 * @property {number} ownedMax 所持している最大巻数。
 * @property {number|null} latestVolume 確認済みの最新巻数。
 * @property {number|null} nextVolumeNumber 次に未所持の巻数。
 * @property {string} nextVolumeIsbn 次巻のISBN-13。
 * @property {string} nextVolumePublished 次巻の刊行日表示。
 * @property {string} nextVolumeTitle 次巻の書名。
 * @property {string} nextVolumeUrl 次巻のNDL書誌ページURL。
 * @property {string} ownershipLabel 所有形態・媒体の表示ラベル。
 */

/**
 * 本棚画面の検索・絞り込み・並び替え条件。
 *
 * @typedef {object} BookFilters
 * @property {string} categoryFilter カテゴリまたはall。
 * @property {"all"|"physical"|"electronic"} ownershipFilter 所有形態。
 * @property {string} platformFilter 電子媒体またはall。
 * @property {string} publisherFilter 出版社またはall。
 * @property {string} authorFilter 著者またはall。
 * @property {number} minimumRating 最低評価。0は指定なし。
 * @property {"all"|"series"|"standalone"} seriesFilter シリーズ有無。
 * @property {string} query 検索語。
 * @property {"newest"|"title"|"author"|"publisher"|"series"|"location"|"manual"} sortMode 並び順。
 * @property {"すべて"|"未読"|"読了"} status 読書状態。
 * @property {string} viewMode 表示モード。
 */

export {};
