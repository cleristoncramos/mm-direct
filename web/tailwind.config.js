/** @type {import('tailwindcss').Config} */
export default {
    content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
    theme: {
        extend: {
            colors: {
                my_blue: "#0c356a",
            },
            // Tipografia única: Inter (ou a fonte do sistema) na interface,
            // monoespaçada só para valores numéricos, IDs e logs.
            fontFamily: {
                sans: ["Inter", "system-ui", "-apple-system", "Segoe UI", "Roboto", "Ubuntu", "Helvetica Neue", "Arial", "sans-serif"],
                mono: ["JetBrains Mono", "ui-monospace", "SFMono-Regular", "Menlo", "Consolas", "Liberation Mono", "monospace"],
            },
        },
    },
    plugins: [require("@tailwindcss/forms")],
};
