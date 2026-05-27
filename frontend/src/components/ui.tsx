import { forwardRef, type ButtonHTMLAttributes, type InputHTMLAttributes, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react";
import { cx } from "../lib/format";

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement>;
type TextInputProps = InputHTMLAttributes<HTMLInputElement>;
type SelectInputProps = SelectHTMLAttributes<HTMLSelectElement>;
type TextareaInputProps = TextareaHTMLAttributes<HTMLTextAreaElement>;
type CheckboxInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, "type">;

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button({ className, ...props }, ref) {
  return <button ref={ref} className={cx(className)} {...props} />;
});

export const TextInput = forwardRef<HTMLInputElement, TextInputProps>(function TextInput({ className, ...props }, ref) {
  return <input ref={ref} className={cx(className)} {...props} />;
});

export const SelectInput = forwardRef<HTMLSelectElement, SelectInputProps>(function SelectInput({ className, ...props }, ref) {
  return <select ref={ref} className={cx(className)} {...props} />;
});

export const TextareaInput = forwardRef<HTMLTextAreaElement, TextareaInputProps>(function TextareaInput({ className, ...props }, ref) {
  return <textarea ref={ref} className={cx(className)} {...props} />;
});

export const CheckboxInput = forwardRef<HTMLInputElement, CheckboxInputProps>(function CheckboxInput({ className, ...props }, ref) {
  return <input ref={ref} type="checkbox" className={cx("h-4 w-4 rounded border-line text-accent focus:ring-teal-100", className)} {...props} />;
});
