// Shared motion presets — one easing vocabulary for the whole app.

import type { Transition, Variants } from "framer-motion";

export const ease = [0.22, 1, 0.36, 1] as const;

export const spring: Transition = { type: "spring", stiffness: 420, damping: 34, mass: 0.8 };
export const softSpring: Transition = { type: "spring", stiffness: 260, damping: 30 };

export const fadeUp: Variants = {
  hidden: { opacity: 0, y: 10 },
  show: { opacity: 1, y: 0, transition: { duration: 0.42, ease } },
};

export const stagger = (step = 0.06, delay = 0): Variants => ({
  hidden: {},
  show: { transition: { staggerChildren: step, delayChildren: delay } },
});

export const viewTransition = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0, transition: { duration: 0.32, ease } },
  exit: { opacity: 0, y: -6, transition: { duration: 0.18, ease } },
};
