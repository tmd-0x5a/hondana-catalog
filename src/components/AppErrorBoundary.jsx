import { Component } from "react";

/**
 * 描画中の例外で画面全体が白画面になることを防ぐ最上位のError Boundary。
 * データはサーバー側に保存済みのため、再読み込みだけで復帰できることを利用者へ伝える。
 */
export class AppErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, errorInfo) {
    console.error("画面の描画に失敗しました。", error, errorInfo);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <main className="app-error-screen" role="alert">
        <h1>画面の表示に失敗しました</h1>
        <p>蔵書データはPC内に保存されています。再読み込みで復帰しない場合は、アプリを再起動してください。</p>
        <pre>{String(this.state.error?.message || this.state.error)}</pre>
        <button onClick={() => window.location.reload()} type="button">再読み込み</button>
      </main>
    );
  }
}
