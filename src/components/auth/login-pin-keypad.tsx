"use client"

import { Button } from "@/components/ui/button"
import { LOGIN_PIN_LENGTH } from "@shared/auth-login-security"
import { cn } from "@/lib/utils"

const DIGITS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0"] as const

export function LoginPinKeypad(props: {
  value: string
  onChange: (next: string) => void
  onComplete?: (pin: string) => void
  disabled?: boolean
}) {
  function appendDigit(digit: string) {
    if (props.disabled || props.value.length >= LOGIN_PIN_LENGTH) return
    const next = `${props.value}${digit}`
    props.onChange(next)
    if (next.length === LOGIN_PIN_LENGTH) {
      props.onComplete?.(next)
    }
  }

  function removeDigit() {
    if (props.disabled || props.value.length === 0) return
    props.onChange(props.value.slice(0, -1))
  }

  return (
    <div className="space-y-3">
      <div className="flex justify-center gap-2">
        {Array.from({ length: LOGIN_PIN_LENGTH }).map((_, index) => (
          <div
            key={index}
            className={cn(
              "flex h-11 w-11 items-center justify-center rounded-md border text-lg font-medium",
              props.value[index] ? "border-primary bg-primary/5" : "border-input bg-background",
            )}
          >
            {props.value[index] ? "•" : ""}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-3 gap-2">
        {DIGITS.slice(0, 9).map((digit) => (
          <Button
            key={digit}
            type="button"
            variant="outline"
            className="h-12 text-lg"
            disabled={props.disabled}
            onClick={() => appendDigit(digit)}
          >
            {digit}
          </Button>
        ))}
        <Button
          type="button"
          variant="outline"
          className="h-12"
          disabled={props.disabled || props.value.length === 0}
          onClick={removeDigit}
        >
          Loeschen
        </Button>
        <Button
          type="button"
          variant="outline"
          className="h-12 text-lg"
          disabled={props.disabled}
          onClick={() => appendDigit("0")}
        >
          0
        </Button>
        <div />
      </div>
      <p className="text-center text-xs text-muted-foreground">
        Geben Sie Ihren {LOGIN_PIN_LENGTH}-stelligen Login-PIN ein. Nach der letzten Ziffer wird die Anmeldung gesendet.
      </p>
    </div>
  )
}
