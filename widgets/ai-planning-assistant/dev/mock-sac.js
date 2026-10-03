// Simuliert, was SAC dem Widget liefert: Properties, Data Binding und das Story-Skript.
(async function () {
  const catalog = await (await fetch("../action-catalog.example.json")).text();
  const widget = document.createElement("com-claudiosignorello-ai-planning-assistant");
  document.getElementById("host").appendChild(widget);

  const pcs = [["PC_1000", "Vertrieb Nord"], ["PC_2000", "Vertrieb Süd"], ["PC_3000", "Service"]];
  const periods = ["202701", "202702", "202703", "202704"];
  const data = [];
  pcs.forEach(([id, label], i) => periods.forEach((p, j) => data.push({
    dimensions_0: { id, label },
    dimensions_1: { id: p, label: p },
    measures_0: { raw: 10000 * (i + 1) + 500 * j, formatted: "" },
  })));
  widget.myDataBinding = {
    state: "success",
    data,
    metadata: {
      dimensions: { dimensions_0: { id: "ProfitCenter", description: "Profitcenter" }, dimensions_1: { id: "Date", description: "Periode" } },
      mainStructureMembers: { measures_0: { id: "Umsatz", label: "Umsatz" } },
    },
  };

  const props = { backendUrl: new URLSearchParams(location.search).get("backend") || "", actionCatalog: catalog, assistantName: "Planungsassistent (Test)" };
  widget.onCustomWidgetBeforeUpdate(props);
  widget.onCustomWidgetAfterUpdate(props);

  // "Story-Skript"
  widget.addEventListener("onActionRequested", () => {
    const id = widget.getPendingActionId();
    const params = widget.getPendingParamNames().split(",").filter(Boolean).map((n) => `${n}=${widget.getPendingParam(n)}`);
    console.log("[Story-Skript] führe aus:", id, params);
    setTimeout(() => widget.setActionResult(id, true, `Simuliert: ${id} (${params.join(", ")})`), 500);
  });
  widget.addEventListener("onDataRefreshRequested", () => console.log("[Story-Skript] refreshData()"));
  window.widget = widget;
})();
