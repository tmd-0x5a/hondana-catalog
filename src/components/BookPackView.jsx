import { useEffect, useState } from "react";
import { BookOpen, ExternalLink, Gift, Plus, Sparkles } from "lucide-react";

import { showFallbackCover } from "../cover-image.js";
import { loadRevealedKeys, saveRevealedKeys } from "../pack-reveal-store.js";

function cardKey(card, index) {
  return String(card.isbn || `${card.title}-${index}`);
}

/** 裏向きのカード。クリックで表返す。 */
function PackCard({ card, revealed, busy, onReveal, onAdd }) {
  return (
    <article className={`pack-card ${card.rare ? "rare" : ""} ${revealed ? "revealed" : ""}`}>
      <div className="pack-card-inner">
        <button
          aria-label={`${card.rare ? "レアカード" : "カード"}をめくる`}
          className="pack-card-back"
          onClick={onReveal}
          type="button"
        >
          <BookOpen size={28} />
          <span>めくる</span>
        </button>
        <div className="pack-card-face" aria-hidden={!revealed}>
          <div className="pack-card-badges">
            {card.rare && <span className="pack-rare"><Sparkles size={11} />レア</span>}
            <span className="pack-genre">{card.reason || card.genre}</span>
          </div>
          <img alt={`${card.title}の表紙`} onError={showFallbackCover} src={card.coverUrl || "/assets/selected-cover.png"} />
          <h3>{card.title}</h3>
          <p>{card.author || "著者情報なし"}</p>
          <span className="pack-card-meta">
            {[card.publisher, card.published].filter(Boolean).join(" / ") || "書誌情報なし"}
          </span>
          {card.description && <p className="pack-card-description">{card.description}</p>}
          <footer>
            {card.url && <a href={card.url} rel="noreferrer" target="_blank" tabIndex={revealed ? 0 : -1}><ExternalLink size={14} />NDL</a>}
            <button disabled={busy || !revealed} onClick={() => onAdd(card)} type="button"><Plus size={15} />本棚に追加</button>
          </footer>
        </div>
      </div>
    </article>
  );
}

/** 生成中に、いま何冊目を探しているかを見せる。 */
function PackProgress({ progress }) {
  const total = Math.max(1, progress?.total || 5);
  const completed = Math.min(progress?.completed || 0, total);
  return (
    <div className="pack-preparing" role="status">
      <Gift size={34} />
      <strong>今日のパックを用意しています</strong>
      <div className="pack-progress-track">
        <div className="pack-progress-bar" style={{ width: `${(completed / total) * 100}%` }} />
      </div>
      <span>{completed} / {total}冊ぶんの候補が見つかりました</span>
      <small>蔵書のジャンルから本を探しています。このまま他の画面を見ていても大丈夫です。</small>
    </div>
  );
}

/**
 * 1日1回のカードパックを開封し、蔵書ジャンルから選ばれた5冊を紹介する。
 * カードは裏向きで並び、クリックした札だけが表へ返る。
 *
 * @param {object} props パックの状態と操作。
 * @param {{status: string, date: string, cards: object[], openedAt: string|null, progress: object}|null} props.pack 今日のパック。
 * @param {boolean} props.busy 追加処理中か。
 * @param {string} props.error エラーメッセージ。
 * @param {() => void} props.onOpen 開封操作。
 * @param {(card: object) => void} props.onAdd 本棚への追加操作。
 * @returns {import("react").ReactElement} パック開封画面。
 */
export function BookPackView({ pack, busy, error, onOpen, onAdd }) {
  const preparing = !pack || pack.status === "preparing";
  const opened = Boolean(pack?.openedAt);
  const cards = pack?.cards || [];
  const date = pack?.date || "";
  const [revealedKeys, setRevealedKeys] = useState([]);

  // 日付が変わった、または別のパックを読み込んだときに、めくり済みの記録を読み直す。
  useEffect(() => {
    setRevealedKeys(date ? loadRevealedKeys(date) : []);
  }, [date]);

  function revealCard(key) {
    setRevealedKeys((current) => {
      if (current.includes(key)) return current;
      const next = [...current, key];
      saveRevealedKeys(date, next);
      return next;
    });
  }

  function revealAll() {
    const keys = cards.map((card, index) => cardKey(card, index));
    setRevealedKeys(keys);
    saveRevealedKeys(date, keys);
  }

  const remaining = cards.filter((card, index) => !revealedKeys.includes(cardKey(card, index))).length;

  return (
    <section className="book-pack-view" aria-label="今日の本のパック">
      <header className="pack-header">
        <div>
          <span><Sparkles size={16} />蔵書のジャンルから抽選</span>
          <h2>本のパック</h2>
          <p>
            {!opened
              ? "1日1パック。蔵書のジャンル比率で4冊、未開拓のジャンルから1冊が入っています。"
              : remaining > 0
                ? `カードをクリックしてめくってください。残り${remaining}枚。`
                : "すべてめくりました。次のパックは明日開けます。"}
          </p>
        </div>
        {opened && remaining > 0 && (
          <button onClick={revealAll} type="button">すべてめくる</button>
        )}
      </header>

      {error && <div className="pack-message">{error}</div>}

      {preparing ? (
        <PackProgress progress={pack?.progress} />
      ) : !opened ? (
        <div className="pack-sealed">
          <button className="pack-seal" disabled={busy || !cards.length} onClick={onOpen} type="button">
            <Gift size={54} />
            <strong>パックを開ける</strong>
            <span>{cards.length}冊入り</span>
          </button>
        </div>
      ) : cards.length === 0 ? (
        <div className="pack-empty">
          <BookOpen size={34} />
          <strong>今日は候補を集められませんでした</strong>
          <span>外部の書誌サービスが混み合っている可能性があります。明日また試してください。</span>
        </div>
      ) : (
        <div className="pack-card-grid">
          {cards.map((card, index) => {
            const key = cardKey(card, index);
            return (
              <PackCard
                busy={busy}
                card={card}
                key={key}
                onAdd={onAdd}
                onReveal={() => revealCard(key)}
                revealed={revealedKeys.includes(key)}
              />
            );
          })}
        </div>
      )}

      <small className="pack-credit">候補: NDLサーチAPI / 紹介文: openBD・Google Books</small>
    </section>
  );
}
