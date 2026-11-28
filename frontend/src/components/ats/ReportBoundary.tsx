import { Component } from "react";
import type { ErrorInfo, ReactNode } from "react";

/**
 * Keeps a report that cannot be drawn from blanking the whole app: React unmounts
 * everything on an uncaught render error. Shows a message in the results panel instead.
 */
export default class ReportBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
    state = { failed: false };

    static getDerivedStateFromError() {
        return { failed: true };
    }

    componentDidCatch(error: Error, info: ErrorInfo) {
        console.error("The ATS report could not be shown:", error, info.componentStack);
    }

    render() {
        if (!this.state.failed) return this.props.children;
        return (
            <div className="flex h-full flex-col items-center justify-center text-center text-gray-500">
                <p className="text-sm font-medium">This result could not be shown.</p>
                <p className="mt-1 text-xs">Run the analysis again. If it keeps happening, restart the ATS service.</p>
            </div>
        );
    }
}
