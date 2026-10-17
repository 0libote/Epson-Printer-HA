export type PrintOptions = {
  copies: number;
  grayscale: boolean;
  paper: "A4" | "Letter";
  orientation: "portrait" | "landscape";
  scaling: "fit" | "actual";
  pages: string;
};

/** Only explicit, bounded options ever reach CUPS. No command fragments. */
export function parsePrintOptions(body: Record<string, unknown>): PrintOptions {
  const copyText = String(body.copies ?? "1").trim();
  const copies = Number(copyText);
  if (
    !/^\d+$/.test(copyText) ||
    !Number.isInteger(copies) ||
    copies < 1 ||
    copies > 99
  ) {
    throw new Error("Copies must be a whole number between 1 and 99.");
  }
  const paper = String(body.paper ?? "A4");
  if (paper !== "A4" && paper !== "Letter")
    throw new Error("Choose A4 or US Letter paper.");
  const orientation = String(body.orientation ?? "portrait");
  if (orientation !== "portrait" && orientation !== "landscape")
    throw new Error("Choose portrait or landscape orientation.");
  const scaling = String(body.scaling ?? "fit");
  if (scaling !== "fit" && scaling !== "actual")
    throw new Error("Choose fit to page or actual size.");
  const pages = String(body.pages ?? "").replace(/\s/g, "");
  if (
    pages.length > 200 ||
    (pages &&
      !/^[1-9]\d{0,4}(?:-[1-9]\d{0,4})?(?:,[1-9]\d{0,4}(?:-[1-9]\d{0,4})?)*$/.test(
        pages,
      ))
  ) {
    throw new Error(
      "Enter pages like 1-3, 5, 8-10, or leave blank for all pages.",
    );
  }
  if (
    pages.split(",").some((range) => {
      const [start, end] = range.split("-").map(Number);
      return end !== undefined && end < start;
    })
  ) {
    throw new Error("Each page range must end on or after its first page.");
  }
  return {
    copies,
    grayscale: body.grayscale === "on" || body.grayscale === true,
    paper,
    orientation,
    scaling,
    pages,
  };
}
