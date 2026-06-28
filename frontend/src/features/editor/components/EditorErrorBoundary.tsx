import React from 'react';

interface Props {
  label?: string; // 出错时显示的面板名（如"预览"/"时间线"）
  children: React.ReactNode;
}

interface State {
  hasError: boolean;
  error?: Error;
}

/**
 * 局部错误边界：包裹单个编辑器面板，某面板渲染崩溃时只在该面板显示兜底 UI，
 * 不影响其余面板和顶栏（避免整个剪辑器白屏）。参考 App.tsx 的全局 ErrorBoundary 模式。
 */
export default class EditorErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: undefined });
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex-1 min-h-0 flex flex-col items-center justify-center gap-3 p-6 bg-[#1f1f1f] text-center">
          <div className="text-sm font-semibold text-white/80">
            {this.props.label ? `${this.props.label}出错了` : '此面板出错了'}
          </div>
          {this.state.error?.message && (
            <pre className="max-w-full max-h-24 overflow-auto text-[11px] text-[#f88]/80 whitespace-pre-wrap">
              {this.state.error.message}
            </pre>
          )}
          <button
            type="button"
            onClick={this.handleRetry}
            className="h-8 px-4 rounded-md bg-[#f01b5c]/90 text-sm font-medium text-white hover:bg-[#f01b5c]"
          >
            重试
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
