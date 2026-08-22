import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { FilterSelect } from "./filter-select";

/** getLabel is the piece added for the Calendar/Search language filters: the
 * stored value (an ISO code) and the displayed label ("Hindi") diverge, and
 * every surface — trigger, option rows, and search — has to agree on which
 * is which, or the filter either shows the wrong thing or stops matching. */
describe("FilterSelect getLabel", () => {
  const codeToName: Record<string, string> = { hi: "Hindi", ta: "Tamil", en: "English" };
  const getLabel = (code: string) => codeToName[code] ?? code;

  it("shows the resting label when nothing is selected", () => {
    render(
      <FilterSelect label="Language" allLabel="All languages" value={null} onChange={() => {}} options={["hi", "ta"]} getLabel={getLabel} />,
    );
    expect(screen.getByRole("button", { name: /language/i })).toHaveTextContent("Language");
  });

  it("shows the full name on the trigger once a code is selected, not the raw code", () => {
    render(
      <FilterSelect label="Language" allLabel="All languages" value="hi" onChange={() => {}} options={["hi", "ta"]} getLabel={getLabel} />,
    );
    expect(screen.getByRole("button", { name: /hindi/i })).toBeInTheDocument();
    expect(screen.queryByText("hi", { selector: "span" })).not.toBeInTheDocument();
  });

  it("lists options by their full name, and selecting one reports the underlying code", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(
      <FilterSelect label="Language" allLabel="All languages" value={null} onChange={onChange} options={["hi", "ta", "en"]} getLabel={getLabel} />,
    );

    await user.click(screen.getByRole("button", { name: /language/i }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Hindi")).toBeInTheDocument();
    expect(within(dialog).getByText("Tamil")).toBeInTheDocument();
    expect(within(dialog).queryByText("hi")).not.toBeInTheDocument();

    await user.click(within(dialog).getByText("Tamil"));
    expect(onChange).toHaveBeenCalledWith("ta");
  });

  it("search matches on the display name even though the option is a raw code", async () => {
    const user = userEvent.setup();
    // searchThreshold=1 forces the search box to render for this small list.
    render(
      <FilterSelect
        label="Language"
        allLabel="All languages"
        value={null}
        onChange={() => {}}
        options={["hi", "ta", "en"]}
        getLabel={getLabel}
        searchThreshold={1}
      />,
    );
    await user.click(screen.getByRole("button", { name: /language/i }));
    const dialog = await screen.findByRole("dialog");
    const box = within(dialog).getByPlaceholderText(/filter language/i);
    await user.type(box, "hindi"); // the DISPLAY name, not the stored code 'hi'
    expect(within(dialog).getByText("Hindi")).toBeInTheDocument();
    expect(within(dialog).queryByText("Tamil")).not.toBeInTheDocument();
  });

  it("without getLabel, falls back to showing the raw value (existing Platform usage)", () => {
    render(
      <FilterSelect label="Platform" allLabel="All platforms" value="Netflix" onChange={() => {}} options={["Netflix", "Prime Video"]} />,
    );
    expect(screen.getByRole("button", { name: /netflix/i })).toBeInTheDocument();
  });
});

describe("FilterSelect multiple", () => {
  const codeToName: Record<string, string> = { hi: "Hindi", ta: "Tamil", en: "English" };
  const getLabel = (code: string) => codeToName[code] ?? code;

  it("picking an option toggles it into the array and keeps the menu open for another pick", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(
      <FilterSelect
        multiple
        label="Language"
        allLabel="All languages"
        value={[]}
        onChange={onChange}
        options={["hi", "ta", "en"]}
        getLabel={getLabel}
      />,
    );

    await user.click(screen.getByRole("button", { name: /language/i }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByText("Tamil"));

    expect(onChange).toHaveBeenCalledWith(["ta"]);
    // Unlike single-select, choosing an option must not close the popover.
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("picking an already-selected option removes it", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(
      <FilterSelect
        multiple
        label="Language"
        allLabel="All languages"
        value={["hi", "ta"]}
        onChange={onChange}
        options={["hi", "ta", "en"]}
        getLabel={getLabel}
      />,
    );

    await user.click(screen.getByRole("button", { name: /hindi/i }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByText("Tamil"));

    expect(onChange).toHaveBeenCalledWith(["hi"]);
  });

  it("shows the first label plus a count once more than one is selected", () => {
    render(
      <FilterSelect
        multiple
        label="Language"
        allLabel="All languages"
        value={["hi", "ta"]}
        onChange={() => {}}
        options={["hi", "ta", "en"]}
        getLabel={getLabel}
      />,
    );
    expect(screen.getByRole("button", { name: /hindi \+1/i })).toBeInTheDocument();
  });

  it("the clear button resets the whole selection to an empty array, not null", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(
      <FilterSelect
        multiple
        label="Language"
        allLabel="All languages"
        value={["hi", "ta"]}
        onChange={onChange}
        options={["hi", "ta", "en"]}
        getLabel={getLabel}
      />,
    );

    await user.click(screen.getByRole("button", { name: /clear language filter/i }));
    expect(onChange).toHaveBeenCalledWith([]);
  });
});
