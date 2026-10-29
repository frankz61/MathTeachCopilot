import { problemsSkill } from './problems.js'
import { designSkill } from './design.js'

export * from './types.js'
export * from './problems.js'
export * from './design.js'

export const skills = { problems: problemsSkill, design: designSkill } as const
export type SkillId = keyof typeof skills
