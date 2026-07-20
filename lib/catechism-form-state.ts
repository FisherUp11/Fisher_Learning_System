export type CatechismFormState = {
  status: "idle" | "success" | "error";
  message: string;
  savedAt?: string;
};

export const initialCatechismFormState: CatechismFormState = {
  status: "idle",
  message: "",
};
