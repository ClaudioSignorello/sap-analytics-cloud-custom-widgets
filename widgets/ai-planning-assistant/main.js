/*
 * AI Planning Assistant – SAP Analytics Cloud Custom Widget (main web component)
 *
 * Verantwortung des Widgets:
 *  - Chat-Oberfläche
 *  - Lesen über das eigene Data Binding ("myDataBinding")
 *  - Tool-Aufrufe des LLM-Backends lokal ausführen (Lesen) bzw. als
 *    bestätigungspflichtige Aktion an das Story-Skript übergeben (Schreiben)
 *
 * Schreiben und Datenaktionen laufen bewusst NICHT im Widget, sondern im
 * Story-Skript (Event onActionRequested), siehe story-script/onActionRequested.js.
 */
(function () {
  const MAX_TOOL_ROUNDS = 5;

  const template = document.createElement("template");
  template.innerHTML = `
    <style>
      :host { display: block; height: 100%; font-family: "72", Arial, sans-serif; font-size: 14px; color: #1d2d3e; }
      .root { display: flex; flex-direction: column; height: 100%; border: 1px solid #d9d9d9; border-radius: 8px; background: #fff; overflow: hidden; }
      header { padding: 10px 12px; background: #0a6ed1; color: #fff; font-weight: 600; display: flex; justify-content: space-between; align-items: center; }
      header .mode { font-size: 11px; font-weight: 400; opacity: .85; }
      .log { flex: 1; overflow-y: auto; padding: 12px; display: flex; flex-direction: column; gap: 8px; background: #f7f7f7; }
      .msg { max-width: 85%; padding: 8px 10px; border-radius: 8px; white-space: pre-wrap; line-height: 1.4; }
      .msg.user { align-self: flex-end; background: #0a6ed1; color: #fff; }
      .msg.assistant { align-self: flex-start; background: #fff; border: 1px solid #e5e5e5; }
      .msg.system { align-self: center; background: transparent; color: #6a6d70; font-size: 12px; }
      .card { align-self: stretch; background: #fff8e1; border: 1px solid #f0c36d; border-radius: 8px; padding: 10px; }
      .card h4 { margin: 0 0 6px; font-size: 14px; }
      .card table { border-collapse: collapse; width: 100%; margin: 6px 0; font-size: 12px; }
      .card td { padding: 2px 4px; border-bottom: 1px solid #f0e0b0; }
      .card .buttons { display: flex; gap: 8px; justify-content: flex-end; }
      button { border: 1px solid #0a6ed1; background: #fff; color: #0a6ed1; border-radius: 6px; padding: 6px 12px; cursor: pointer; font: inherit; }
      button.primary { background: #0a6ed1; color: #fff; }
      button:disabled { opacity: .5; cursor: default; }
      form { display: flex; gap: 8px; padding: 10px; border-top: 1px solid #e5e5e5; }
      textarea { flex: 1; resize: none; height: 38px; padding: 8px; border: 1px solid #bfbfbf; border-radius: 6px; font: inherit; }
    </style>
    <div class="root">
      <header><span class="title"></span><span class="mode"></span></header>
      <div class="log" part="log"></div>
      <form>
        <textarea placeholder="Frag mich etwas zu deiner Planung …"></textarea>
        <button class="primary" type="submit">Senden</button>
      </form>
    </div>
  `;

  /** Lese-Adapter auf das Data Binding des Widgets. */
  class DataBindingAdapter {
    constructor(widget) {
      this.widget = widget;
    }

    /** Ergebnismenge im SAC-Format: { state, data: [...rows], metadata: {...} } */
    get binding() {
      return this.widget.myDataBinding;
    }

    isReady() {
      return !!(this.binding && this.binding.state === "success" && Array.isArray(this.binding.data));
    }

    /** Dimensionen und Kennzahlen, wie sie im Builder gebunden sind. */
    describe() {
      const md = (this.binding && this.binding.metadata) || {};
      const dims = Object.entries(md.dimensions || {}).map(([key, d]) => ({ key, id: d.id, description: d.description || d.id }));
      const measures = Object.entries(md.mainStructureMembers || {}).map(([key, m]) => ({ key, id: m.id, label: m.label || m.id }));
      return { dimensions: dims, measures };
    }

    /** Distinct-Member je Dimension (auf die ersten n begrenzt, um den Prompt klein zu halten). */
    members(limit = 50) {
      const { dimensions } = this.describe();
      const out = {};
      for (const d of dimensions) {
        const seen = new Map();
        for (const row of this.binding.data) {
          const cell = row[d.key];
          if (cell && !seen.has(cell.id)) seen.set(cell.id, cell.label || cell.id);
          if (seen.size >= limit) break;
        }
        out[d.id] = [...seen].map(([id, label]) => ({ id, label }));
      }
      return out;
    }

    /**
     * Aggregiert die gebundenen Daten.
     * @param {{filters?: Object<string,string|string[]>, groupBy?: string[], measures?: string[]}} args
     *   filters: Dimension-ID -> Member-ID oder -Label (oder Liste davon)
     */
    query(args = {}) {
      if (!this.isReady()) return { error: "Keine Daten gebunden oder Daten noch nicht geladen." };
      const { dimensions, measures } = this.describe();
      const dimByName = (name) => dimensions.find((d) => d.id === name || d.description === name);
      const filters = Object.entries(args.filters || {}).map(([name, val]) => {
        const d = dimByName(name);
        return { d, name, values: [].concat(val).map((v) => String(v).toLowerCase()) };
      });
      const unknown = filters.filter((f) => !f.d).map((f) => f.name);
      if (unknown.length) return { error: `Unbekannte Dimension(en): ${unknown.join(", ")}`, availableDimensions: dimensions.map((d) => d.id) };

      const groupDims = (args.groupBy || []).map(dimByName).filter(Boolean);
      const selMeasures = args.measures && args.measures.length
        ? measures.filter((m) => args.measures.includes(m.id) || args.measures.includes(m.label))
        : measures;

      const groups = new Map();
      let matched = 0;
      for (const row of this.binding.data) {
        const ok = filters.every(({ d, values }) => {
          const cell = row[d.key] || {};
          return values.includes(String(cell.id).toLowerCase()) || values.includes(String(cell.label).toLowerCase());
        });
        if (!ok) continue;
        matched++;
        const key = groupDims.map((d) => (row[d.key] || {}).label || (row[d.key] || {}).id).join(" | ");
        const acc = groups.get(key) || Object.fromEntries(selMeasures.map((m) => [m.label, 0]));
        for (const m of selMeasures) acc[m.label] += Number((row[m.key] || {}).raw) || 0;
        groups.set(key, acc);
      }
      return {
        matchedRows: matched,
        groupBy: groupDims.map((d) => d.id),
        result: [...groups].map(([group, values]) => ({ group: group || "Gesamt", values })),
        note: matched === 0
          ? "Keine passenden Zeilen in den gebundenen Daten. Mögliche Ursachen: Filter der Story, Version, nicht gebundene Dimension oder keine gebuchten Werte."
          : undefined,
      };
    }

    /** Filter und Variablen der Datenquelle (soweit die API im Tenant verfügbar ist). */
    async runtimeContext() {
      const ctx = {};
      try {
        const db = this.widget.dataBindings && this.widget.dataBindings.getDataBinding("myDataBinding");
        const ds = db && (await db.getDataSource());
        if (ds && typeof ds.getDimensionFilters === "function") {
          ctx.filters = {};
          for (const d of this.describe().dimensions) {
            try {
              const f = await ds.getDimensionFilters(d.id);
              if (f && f.length) ctx.filters[d.id] = f;
            } catch (e) { /* Dimension ohne Filter */ }
          }
        }
        if (ds && typeof ds.getVariables === "function") {
          const vars = await ds.getVariables();
          ctx.variables = (vars || []).map((v) => ({ id: v.id, description: v.description }));
        }
      } catch (e) {
        ctx.warning = "DataSource-API nicht verfügbar: " + (e && e.message);
      }
      return ctx;
    }
  }

  class AIPlanningAssistant extends HTMLElement {
    constructor() {
      super();
      this._shadow = this.attachShadow({ mode: "open" });
      this._shadow.appendChild(template.content.cloneNode(true));
      this._props = { backendUrl: "", actionCatalog: "[]", assistantName: "Planungsassistent" };
      this._messages = []; // Verlauf für das Backend: {role, content}
      this._contextNotes = [];
      this._pending = null; // vom Nutzer bestätigte Aktion
      this._pendingToolCall = null; // Tool-Call, auf dessen Ergebnis das Backend wartet
      this._busy = false;
      this._data = new DataBindingAdapter(this);

      this._log = this._shadow.querySelector(".log");
      this._input = this._shadow.querySelector("textarea");
      this._sendBtn = this._shadow.querySelector("button[type=submit]");
      this._shadow.querySelector("form").addEventListener("submit", (e) => {
        e.preventDefault();
        this._onUserInput();
      });
      this._input.addEventListener("keydown", (e) => {
        if (e.key === "Enter" && !e.shiftKey) {
          e.preventDefault();
          this._onUserInput();
        }
      });
    }

    // ---------- SAC-Lebenszyklus ----------

    onCustomWidgetBeforeUpdate(changedProperties) {
      this._props = { ...this._props, ...changedProperties };
    }

    onCustomWidgetAfterUpdate(changedProperties) {
      this._props = { ...this._props, ...changedProperties };
      this._renderHeader();
      if (!this._greeted) {
        this._greeted = true;
        this._addMessage("assistant", "Hallo! Ich beantworte Fragen zu den Planungsdaten und kann freigegebene Datenaktionen für dich vorbereiten.");
      }
    }

    onCustomWidgetResize() {}

    onCustomWidgetDestroy() {}

    // ---------- Skript-Methoden (siehe JSON "methods") ----------

    setBackendUrl(url) {
      this._props.backendUrl = url;
      this._renderHeader();
    }

    setActionCatalog(catalogJson) {
      this._props.actionCatalog = catalogJson;
    }

    getPendingActionId() {
      return this._pending ? this._pending.actionId : "";
    }

    getPendingParam(name) {
      if (!this._pending) return "";
      const v = this._pending.params[name];
      return v === undefined || v === null ? "" : String(v);
    }

    getPendingParamNames() {
      return this._pending ? Object.keys(this._pending.params).join(",") : "";
    }

    setActionResult(actionId, success, message) {
      const text = `${success ? "✓" : "✗"} ${message || actionId}`;
      this._addMessage("system", text);
      const toolCall = this._pendingToolCall;
      this._pending = null;
      this._pendingToolCall = null;
      if (success) this.dispatchEvent(new Event("onDataRefreshRequested"));
      if (toolCall && this._props.backendUrl) {
        this._continueWithToolResult(toolCall, { actionId, success, message });
      }
    }

    addContextNote(note) {
      this._contextNotes.push(note);
      if (this._contextNotes.length > 10) this._contextNotes.shift();
    }

    // ---------- Chat ----------

    async _onUserInput() {
      const text = this._input.value.trim();
      if (!text || this._busy) return;
      this._input.value = "";
      this._addMessage("user", text);
      this._messages.push({ role: "user", content: text });

      if (!this._props.backendUrl) {
        this._demoAnswer(text);
        return;
      }
      await this._runAgentLoop();
    }

    /** Fragt das Backend, führt Lese-Tools lokal aus, bis eine Antwort oder eine Aktion vorliegt. */
    async _runAgentLoop(initialToolResult) {
      this._setBusy(true);
      try {
        let toolResult = initialToolResult;
        for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
          const res = await this._callBackend(toolResult);
          if (res.type === "message") {
            this._addMessage("assistant", res.text);
            this._messages.push({ role: "assistant", content: res.text });
            return;
          }
          if (res.type !== "tool_call") throw new Error("Unerwartete Backend-Antwort");

          const call = { id: res.id, name: res.name, arguments: res.arguments || {} };
          if (call.name === "propose_action") {
            this._showActionCard(call);
            return; // wartet auf Bestätigung und setActionResult()
          }
          toolResult = { call, output: await this._runReadTool(call) };
        }
        this._addMessage("system", "Abgebrochen: zu viele Zwischenschritte.");
      } catch (e) {
        this._addMessage("system", "Fehler beim Backend: " + (e && e.message));
      } finally {
        this._setBusy(false);
      }
    }

    _continueWithToolResult(call, output) {
      this._runAgentLoop({ call, output });
    }

    async _runReadTool(call) {
      switch (call.name) {
        case "query_data":
          return this._data.query(call.arguments);
        case "get_context":
          return this._buildContext();
        default:
          return { error: `Unbekanntes Tool: ${call.name}` };
      }
    }

    async _callBackend(toolResult) {
      const body = {
        messages: this._messages,
        context: await this._buildContext(),
        toolResult: toolResult || null,
      };
      const resp = await fetch(this._props.backendUrl.replace(/\/$/, "") + "/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include", // SSO-Cookie bzw. Session des Backends
        body: JSON.stringify(body),
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      return resp.json();
    }

    async _buildContext() {
      return {
        model: this._data.isReady() ? this._data.describe() : null,
        members: this._data.isReady() ? this._data.members(30) : null,
        runtime: await this._data.runtimeContext(),
        actions: this._catalog(),
        notes: this._contextNotes,
        locale: navigator.language,
      };
    }

    _catalog() {
      try {
        const c = JSON.parse(this._props.actionCatalog || "[]");
        return Array.isArray(c) ? c : [];
      } catch (e) {
        return [];
      }
    }

    // ---------- Aktionen mit Bestätigung ----------

    _showActionCard(call) {
      const { actionId, params = {}, summary } = call.arguments;
      const action = this._catalog().find((a) => a.id === actionId);
      if (!action) {
        this._addMessage("system", `Aktion "${actionId}" ist nicht freigegeben.`);
        this._continueWithToolResult(call, { error: "Aktion nicht im Katalog" });
        return;
      }
      const missing = (action.parameters || []).filter((p) => p.required && (params[p.id] === undefined || params[p.id] === ""));

      const card = document.createElement("div");
      card.className = "card";
      const h = document.createElement("h4");
      h.textContent = action.label || action.id;
      card.appendChild(h);
      if (summary) {
        const p = document.createElement("div");
        p.textContent = summary;
        card.appendChild(p);
      }
      const table = document.createElement("table");
      for (const [k, v] of Object.entries(params)) {
        const tr = table.insertRow();
        tr.insertCell().textContent = k;
        tr.insertCell().textContent = String(v);
      }
      card.appendChild(table);
      if (missing.length) {
        const warn = document.createElement("div");
        warn.textContent = "Fehlende Pflichtparameter: " + missing.map((p) => p.id).join(", ");
        card.appendChild(warn);
      }
      const buttons = document.createElement("div");
      buttons.className = "buttons";
      const cancel = document.createElement("button");
      cancel.textContent = "Abbrechen";
      const run = document.createElement("button");
      run.className = "primary";
      run.textContent = "Ausführen";
      run.disabled = missing.length > 0;
      buttons.append(cancel, run);
      card.appendChild(buttons);
      this._log.appendChild(card);
      this._scroll();

      cancel.addEventListener("click", () => {
        run.disabled = cancel.disabled = true;
        this._addMessage("system", "Aktion abgebrochen.");
        if (this._props.backendUrl) this._continueWithToolResult(call, { cancelled: true });
      });
      run.addEventListener("click", () => {
        run.disabled = cancel.disabled = true;
        this._pending = { actionId, params };
        this._pendingToolCall = call;
        this._addMessage("system", "Aktion wird ausgeführt …");
        this.dispatchEvent(new Event("onActionRequested"));
      });
    }

    // ---------- Demo-Modus ohne Backend ----------

    _demoAnswer(text) {
      const lower = text.toLowerCase();
      const catalog = this._catalog();

      if (/aktion|verteil|kopier|spread/.test(lower) && catalog.length) {
        const a = catalog[0];
        const params = Object.fromEntries((a.parameters || []).map((p) => [p.id, p.default !== undefined ? p.default : ""]));
        this._showActionCard({ id: "demo", name: "propose_action", arguments: { actionId: a.id, params, summary: "Demo: Vorschlag mit Standardwerten." } });
        return;
      }
      if (!this._data.isReady()) {
        this._addMessage("assistant", "Demo-Modus: Bitte binde das Widget im Builder an ein Modell und hinterlege eine Backend-URL für echte KI-Antworten.");
        return;
      }
      // Member suchen, die in der Frage vorkommen, und als Filter verwenden
      const filters = {};
      for (const [dim, members] of Object.entries(this._data.members(500))) {
        const hit = members.find((m) => lower.includes(String(m.label).toLowerCase()) || lower.includes(String(m.id).toLowerCase()));
        if (hit) filters[dim] = hit.id;
      }
      const res = this._data.query({ filters });
      if (res.error || !res.result.length) {
        this._addMessage("assistant", res.error || res.note);
        return;
      }
      const values = Object.entries(res.result[0].values)
        .map(([m, v]) => `${m}: ${v.toLocaleString(undefined, { maximumFractionDigits: 2 })}`)
        .join("\n");
      const f = Object.entries(filters).map(([d, m]) => `${d} = ${m}`).join(", ") || "ohne Filter";
      this._addMessage("assistant", `Demo-Modus (${f}):\n${values}`);
    }

    // ---------- UI-Helfer ----------

    _renderHeader() {
      this._shadow.querySelector(".title").textContent = this._props.assistantName || "Planungsassistent";
      this._shadow.querySelector(".mode").textContent = this._props.backendUrl ? "KI verbunden" : "Demo-Modus";
    }

    _addMessage(role, text) {
      const div = document.createElement("div");
      div.className = "msg " + role;
      div.textContent = text; // nie innerHTML: LLM-Ausgaben werden nicht als HTML interpretiert
      this._log.appendChild(div);
      this._scroll();
    }

    _setBusy(busy) {
      this._busy = busy;
      this._sendBtn.disabled = busy;
    }

    _scroll() {
      this._log.scrollTop = this._log.scrollHeight;
    }
  }

  customElements.define("com-claudiosignorello-ai-planning-assistant", AIPlanningAssistant);
})();
