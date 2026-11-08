import { opskitLibrary, opskitPromptOptions } from "../src/openui";

// jsdom has no canvas.
vi.mock("uplot", () => ({ default: class {} }));

const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};

// `pnpm --filter @opskit/ui prompt` prints the exact system prompt the model sees.
describe("system prompt", () => {
  const prompt = opskitLibrary.prompt(opskitPromptOptions);

  it("lists every component with its positional signature", () => {
    for (const name of ["Stack(", "Row(", "Heading(", "Text(", "PromChart(", "StatTile("]) {
      expect(prompt).toContain(name);
    }
    if (env.OPSKIT_PRINT_PROMPT) console.log(prompt);
  });
});
