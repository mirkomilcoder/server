import { Component, type ReactNode } from 'react';
import { AlertTriangle } from 'lucide-react';
import { useT } from '@/i18n';

/*
 * One boundary per page: a crash in one page shows this card instead of a
 * blank screen, and the sidebar / other pages keep working.
 */

interface Props {
  children: ReactNode;
  /** Changing this key resets the boundary (e.g. on navigation). */
  resetKey?: string;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidUpdate(prev: Props) {
    if (prev.resetKey !== this.props.resetKey && this.state.error) this.setState({ error: null });
  }

  componentDidCatch(error: Error) {
    console.error('[mirkomil] page crashed:', error);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return <ErrorCard error={this.state.error} onRetry={() => this.setState({ error: null })} />;
  }
}

function ErrorCard({ error, onRetry }: { error: Error; onRetry: () => void }) {
  const { t } = useT();
  return (
    <div className="card" role="alert">
      <div className="empty">
        <div className="empty__icon tint--danger">
          <AlertTriangle size={28} strokeWidth={1.8} />
        </div>
        <h2>{t('error.title')}</h2>
        <p>{t('error.body')}</p>
        <button className="btn btn--accent" onClick={onRetry}>
          {t('common.retry')}
        </button>
        <details className="toast__details" style={{ width: '100%', maxWidth: 560, textAlign: 'left' }}>
          <summary>{t('common.details')}</summary>
          <pre>{`${error.name}: ${error.message}\n${error.stack ?? ''}`}</pre>
        </details>
      </div>
    </div>
  );
}
