import type { ComponentPropsWithRef } from 'react';
import styles from './help-button.module.css';
/** Small tactile glyph with a full 44px keyboard/touch target. */
export function HelpButton({ label = '도움말', className = '', ...props }: Omit<ComponentPropsWithRef<'button'>, 'children'> & { label?: string }) {
  return <button {...props} type={props.type ?? 'button'} className={`${styles.button} ${className}`} aria-label={label}><span aria-hidden="true">?</span></button>;
}
