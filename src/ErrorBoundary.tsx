import React from 'react';

export default class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { err?: any }
> {
  state = { err: null as any };

  static getDerivedStateFromError(err: any) {
    return { err };
  }

  componentDidCatch(err: any, info: any) {
    console.error(err, info);
  }

  render() {
    if (!this.state.err) return this.props.children;
    const message =
      this.state.err?.message != null
        ? String(this.state.err.message)
        : String(this.state.err);
    return (
      <div style={{ color: 'crimson', padding: 16 }}>
        <div>Runtime error. Open console.</div>
        <div>{message}</div>
      </div>
    );
  }
}
