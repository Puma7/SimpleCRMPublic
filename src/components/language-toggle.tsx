"use client"

import { Languages } from "lucide-react"
import { LANGUAGES, useTranslation, type Language } from "@/lib/i18n"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

const LANGUAGE_LABEL_KEY: Record<Language, "language.de" | "language.en"> = {
  de: "language.de",
  en: "language.en",
}

export function LanguageToggle({ className }: { className?: string }) {
  const { language, setLanguage, t } = useTranslation()

  return (
    <Select value={language} onValueChange={(value) => setLanguage(value as Language)}>
      <SelectTrigger className={className} aria-label={t("language.label")}>
        <span className="flex items-center gap-2">
          <Languages className="h-4 w-4" />
          <SelectValue />
        </span>
      </SelectTrigger>
      <SelectContent>
        {LANGUAGES.map((lang) => (
          <SelectItem key={lang} value={lang}>
            {t(LANGUAGE_LABEL_KEY[lang])}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
