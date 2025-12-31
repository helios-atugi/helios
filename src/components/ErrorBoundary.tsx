import React from 'react'

type Props = { children: React.ReactNode }
type State = { err?: unknown }

export default class ErrorBoundary extends React.Component<Props, State> {
  state: State = { err: undefined }

  static getDerivedStateFromError(err: unknown) {
    return { err }
  }

  componentDidCatch(err: unknown, info: unknown) {
    console.error(err, info)
  }

  render() {
    if (!this.state.err) return this.props.children
    const message =
      (this.state.err as any)?.message != null
        ? String((this.state.err as any).message)
        : String(this.state.err)
    return (
      <div style={{ color: 'crimson', padding: 16 }}>
        <div>Runtime error. Open console.</div>
        <div>{message}</div>
      </div>
    )
  }
}
