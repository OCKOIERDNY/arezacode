export function skillCommand(skill: { name: string; description?: string; content: string; location: string }) {
  const directory = skill.location === "<built-in>" ? undefined : skill.location.replaceAll("\\", "/").replace(/\/[^/]+$/, "")
  return {
    name: skill.name,
    description: skill.description,
    source: "skill" as const,
    template: directory
      ? `${skill.content}\n\nBase directory for this skill: ${directory}\nRelative paths in this skill (e.g., scripts/, references/) are relative to this base directory.`
      : skill.content,
  }
}
