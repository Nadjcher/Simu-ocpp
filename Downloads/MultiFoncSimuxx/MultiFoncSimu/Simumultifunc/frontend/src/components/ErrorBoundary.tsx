import React from "react";

type Props = { children: React.ReactNode; fallback?: React.ReactNode };
type State = { hasError: boolean; err?: unknown };

export default class ErrorBoundary extends React.Component<Props, State> {
    state: State = { hasError: false };

    static getDerivedStateFromError(err: unknown) {
        return { hasError: true, err };
    }
    componentDidCatch(err: unknown, info: unknown) {
        // utile pour diagnostiquer les "pages blanches"
        console.error("ErrorBoundary:", err, info);
    }

    render() {
        if (this.state.hasError) {
            return (
                this.props.fallback ?? (
                    <div className="p-4 rounded border bg-rose-50 text-rose-700">
                        Une erreur est survenue dans cet onglet. Les détails sont dans la console.
                    </div>
                )
            );
        }
        return this.props.children;
    }
}
