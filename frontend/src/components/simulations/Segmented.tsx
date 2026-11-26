import { useId } from "react";

interface Props<T extends string> {
    label: string;
    options: readonly { value: T; label: string }[];
    value: T;
    onChange: (value: T) => void;
    /** Show the label above the options, or only to screen readers. */
    showLabel?: boolean;
}

/** A row of options where one is chosen. Real radio buttons, so the arrow keys move between them. */
export default function Segmented<T extends string>({ label, options, value, onChange, showLabel = true }: Props<T>) {
    const name = useId();
    return (
        <fieldset>
            <legend className={showLabel ? "mb-1.5 text-xs font-medium text-gray-500" : "sr-only"}>{label}</legend>
            <div className="flex gap-1 rounded-xl bg-gray-100 p-1">
                {options.map((o) => (
                    <label
                        key={o.value}
                        className={`flex-1 cursor-pointer rounded-lg px-2 py-1.5 text-center text-xs font-medium transition-colors has-focus-visible:ring-2 has-focus-visible:ring-gray-400 ${value === o.value ? "bg-white text-gray-900 shadow-sm" : "text-gray-600 hover:text-gray-900"
                            }`}
                    >
                        <input
                            type="radio"
                            name={name}
                            value={o.value}
                            checked={value === o.value}
                            onChange={() => onChange(o.value)}
                            className="sr-only"
                        />
                        {o.label}
                    </label>
                ))}
            </div>
        </fieldset>
    );
}
