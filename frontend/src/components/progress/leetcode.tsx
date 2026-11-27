import { useMemo } from "react";
import { SquareArrowOutUpRight } from "lucide-react";
import LeetCodeSegmentCircle from "./progressbar";
import { useLeetCode } from "@/lib/queries";

export default function LeetCodeCard({ leetcodeLink }: { leetcodeLink: string }) {
    const username = useMemo(() => {
        const x = leetcodeLink.trim().replace(/\/+$/, "");
        return x.split("/u/")[1];
    }, [leetcodeLink]);

    const { data, isLoading: loading } = useLeetCode(username);
    const stats = data ?? null;

    const streak = useMemo(() => {
        const cal = stats?.submissionCalendar || {};
        const days = Object.keys(cal).map(Number).map((t) => Math.floor(t / 86400)).sort((a, b) => b - a);
        let c = 0;
        let d = Math.floor(Date.now() / 1000 / 86400);
        while (days.includes(d)) { c++; d--; }
        return c;
    }, [stats]);

    if (loading) {
        return (
            <div className="bg-white border border-gray-200 rounded-2xl p-6 flex items-center justify-center h-64 text-gray-500 text-sm">
                Loading LeetCode data…
            </div>
        );
    }

    if (!stats) {
        return (
            <div className="bg-white border border-gray-200 rounded-2xl p-6 flex items-center justify-center h-64 text-center text-gray-500 text-sm">
                {username ? "LeetCode data could not be loaded." : "Add your LeetCode profile URL to see your progress."}
            </div>
        );
    }

    return (
        <div className="bg-white border border-gray-200 rounded-2xl p-4 w-full h-64 flex flex-col justify-between overflow-hidden">
            <div className="flex justify-between items-start">
                <div>
                    <p className="text-[10px] text-gray-500">LeetCode Progress</p>
                    <h1 className="text-xl font-bold text-gray-900">{stats.totalSolved}</h1>
                    <p className="text-[10px] text-gray-500">Total Solved</p>
                </div>

                <button
                    onClick={() => window.open(leetcodeLink, "_blank")}
                    className="flex items-center text-gray-800 text-[0.8rem] hover:underline"
                >
                    {username} <SquareArrowOutUpRight size={10} className="ml-1" />
                </button>
            </div>

            {/* min-h-0 lets this row take the card's remaining height, so the
                gauge is sized by that height and not by the card's width. */}
            <div className="flex flex-1 min-h-0 items-center justify-between gap-2 pt-2">
                <div className="shrink-0 space-y-2 text-center">
                    <div className="py-2 px-3 bg-[#fafafa] rounded-lg">
                        <p className="text-[10px] text-gray-500">Ranking</p>
                        <p className="text-lg font-semibold text-gray-800">#{stats.ranking}</p>
                    </div>
                    <div className="py-2 px-3 bg-[#fafafa] rounded-lg">
                        <p className="text-[10px] text-gray-500">Streak</p>
                        <p className="text-lg font-semibold text-gray-800">{streak} days</p>
                    </div>
                </div>

                <div className="flex h-full min-w-0 flex-1 items-center justify-center">
                    <div className="aspect-square h-full max-w-full">
                        <LeetCodeSegmentCircle
                        totalEasy={stats.totalEasy}
                        totalMedium={stats.totalMedium}
                        totalHard={stats.totalHard}
                        solvedEasy={stats.easySolved}
                        solvedMedium={stats.mediumSolved}
                        solvedHard={stats.hardSolved}
                        />
                    </div>
                </div>

                <div className="shrink-0 space-y-1.5 text-center text-[10px]">
                    <div className="p-2 bg-[#fafafa] rounded-lg">
                        <p className="text-[#1CBABA] font-medium">Easy</p>
                        <p className="text-gray-800 font-semibold">{stats.easySolved}/{stats.totalEasy}</p>
                    </div>
                    <div className="p-2 bg-[#fafafa] rounded-lg">
                        <p className="text-[#FFB700] font-medium">Medium</p>
                        <p className="text-gray-800 font-semibold">{stats.mediumSolved}/{stats.totalMedium}</p>
                    </div>
                    <div className="p-2 bg-[#fafafa] rounded-lg">
                        <p className="text-[#F63737] font-medium">Hard</p>
                        <p className="text-gray-800 font-semibold">{stats.hardSolved}/{stats.totalHard}</p>
                    </div>
                </div>
            </div>
        </div>
    );
}
