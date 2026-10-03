// SAC Story-Skript: Event "onActionRequested" des Widgets AIPlanningAssistant_1
//
// Voraussetzungen in der Story:
//  - Technisches Objekt Data Action "DataAction_Distribute" (Parameter: Anteil, Zielperiode, ProfitCenter)
//  - Technisches Objekt Multi Action "MultiAction_CopyVersion" (Parameter: QuellVersion, ZielVersion)
//  - Planungsfähige Tabelle "Table_1" auf demselben Modell
//
// Nur Aktionen aus dieser Whitelist werden ausgeführt, egal was das LLM vorschlägt.
// Methoden- und Enum-Namen bitte gegen die Scripting-Referenz eures Tenants prüfen.

var actionId = AIPlanningAssistant_1.getPendingActionId();

if (actionId === "DISTRIBUTE_TO_PERIOD") {
	DataAction_Distribute.setParameterValue("Anteil", ConvertUtils.stringToNumber(AIPlanningAssistant_1.getPendingParam("Anteil")));
	DataAction_Distribute.setParameterValue("Zielperiode", AIPlanningAssistant_1.getPendingParam("Zielperiode"));
	DataAction_Distribute.setParameterValue("ProfitCenter", AIPlanningAssistant_1.getPendingParam("ProfitCenter"));
	var res = DataAction_Distribute.execute();
	var ok = res.status === DataActionExecutionResponseStatus.Success;
	AIPlanningAssistant_1.setActionResult(actionId, ok, ok ? "Verteilung ausgeführt." : "Data Action fehlgeschlagen.");

} else if (actionId === "COPY_VERSION") {
	MultiAction_CopyVersion.setParameterValue("QuellVersion", AIPlanningAssistant_1.getPendingParam("QuellVersion"));
	MultiAction_CopyVersion.setParameterValue("ZielVersion", AIPlanningAssistant_1.getPendingParam("ZielVersion"));
	MultiAction_CopyVersion.execute();
	AIPlanningAssistant_1.setActionResult(actionId, true, "Multi Action gestartet.");

} else if (actionId === "SUBMIT") {
	Table_1.getPlanning().submitData();
	AIPlanningAssistant_1.setActionResult(actionId, true, "Eingaben übernommen.");

} else {
	AIPlanningAssistant_1.setActionResult(actionId, false, "Aktion ist in dieser Story nicht freigegeben.");
}
