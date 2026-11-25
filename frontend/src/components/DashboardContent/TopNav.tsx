interface TopNavProps {
    /** Breadcrumb after the app name, for example ["Simulations", "Reviews"]. */
    path: string[];
}

export default function TopNav({ path }: TopNavProps) {
    const trail = ["InterviewMate", ...path];

    return (
        <div className="p-2 pb-0">
            <nav
                aria-label="Breadcrumb"
                className="w-full flex items-center px-6 py-3 bg-[#F9F9F9] border-[#E5E5E5] border rounded-2xl"
            >
                <ol className="text-sm text-gray-600 flex items-center gap-2">
                    {trail.map((item, i) => {
                        const last = i === trail.length - 1;
                        return (
                            <li key={item} className="flex items-center gap-2" aria-current={last ? "page" : undefined}>
                                <span className={last ? "font-medium text-gray-800" : "opacity-70"}>{item}</span>
                                {!last && <span className="opacity-50" aria-hidden>/</span>}
                            </li>
                        );
                    })}
                </ol>
            </nav>
        </div>
    );
}
