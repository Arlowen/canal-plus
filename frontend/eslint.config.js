import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist"] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "react-refresh/only-export-components": ["warn", { allowConstantExport: true }]
    }
  },
  {
    files: ["src/**/*.{ts,tsx}"],
    ignores: ["src/components/ui.tsx"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector: "JSXOpeningElement[name.name='button']",
          message: "Use the shared <Button /> component from src/components/ui.tsx."
        },
        {
          selector: "JSXOpeningElement[name.name='input']",
          message: "Use the shared input components from src/components/ui.tsx."
        },
        {
          selector: "JSXOpeningElement[name.name='select']",
          message: "Use the shared <SelectInput /> component from src/components/ui.tsx."
        },
        {
          selector: "JSXOpeningElement[name.name='textarea']",
          message: "Use the shared <TextareaInput /> component from src/components/ui.tsx."
        }
      ]
    }
  }
);
