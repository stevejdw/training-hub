'use client';

import React from 'react';

interface Props {
  children: React.ReactNode;
  fallback?: React.ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export default class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('BlockView crash:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      console.error('Rendering error in BlockView:', this.state.error);
      return this.props.fallback ?? (
        <div className="p-4 text-center">
          <p className="text-sm text-red-400">Something went wrong.</p>
          <button
            onClick={() => this.setState({ hasError: false, error: null })}
            className="mt-2 text-xs text-gray-400 hover:text-white underline"
          >
            Try again
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
