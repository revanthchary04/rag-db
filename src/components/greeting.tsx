import { motion, useReducedMotion } from 'framer-motion'

export const Greeting = () => {
  const reduceMotion = useReducedMotion()
  const rise = reduceMotion
    ? { initial: { opacity: 0 }, animate: { opacity: 1 } }
    : { initial: { opacity: 0, y: 8 }, animate: { opacity: 1, y: 0 } }

  return (
    <div className="mx-auto flex max-w-2xl flex-col items-center text-center" key="overview">
      <motion.h2
        {...rise}
        className="text-balance font-semibold text-3xl leading-[1.1] tracking-[-0.02em] md:text-4xl"
        transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
      >
        Ask your documents anything.
      </motion.h2>
      <motion.p
        {...rise}
        className="mt-4 text-balance text-base text-muted-foreground leading-relaxed md:text-lg"
        transition={{ duration: 0.4, delay: 0.06, ease: [0.16, 1, 0.3, 1] }}
      >
        Every answer carries its sources, latency, and cost, then lands in a query log you can
        replay, evaluate, and compare across runs.
      </motion.p>
    </div>
  )
}
