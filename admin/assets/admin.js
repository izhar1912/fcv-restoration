/* FCV portal: administration. Everything here is a convenience; the server re-checks every action (requireAdmin). */
(function () {
  "use strict";
  const F = window.FCV;
  const {
    html,
    raw,
    mount,
    api,
    money,
    icons,
    dateOnly,
    dateTime,
    ago,
    toCents,
    fromCents,
    toast,
  } = F;
  const T = F.tracker;
  const STAGES = [...T.STEPS, ["declined", "Closed / declined"]];
  const STAGE_LABEL = Object.fromEntries(STAGES);
  const KEY = {
    "budget-lines": "budgetLines",
    expenses: "expenses",
    supplements: "supplements",
    draws: "draws",
    "remaining-items": "remaining",
  };
  const LINK = {
    expenses: "expense",
    supplements: "supplement",
    draws: "draw",
  };
  const SUP_STATUS = [
    "Draft",
    "Submitted",
    "Approved",
    "Rejected",
    "Withdrawn",
  ];
  const DRAW_STATUS = [
    "Proposed - not submitted",
    "Submitted",
    "Approved",
    "Partially funded",
    "Funded",
    "Rejected",
  ];
  const DOC_KINDS = [
    ["receipt", "Receipt"],
    ["supporting", "Supporting document"],
    ["contract", "Contract"],
    ["other", "Other"],
  ];
  const $ = (el, s) => el.querySelector(s);
  const stageChip = (s) =>
    html`<span
      class="chip ${s === "declined"
        ? "dim"
        : s === "work_in_progress"
          ? "gold"
          : ""}"
      ><span class="dot"></span>${STAGE_LABEL[s] || s}</span
    >`;
  const errBox = (e) =>
    html`<div class="callout bad">
      <span>${raw(icons.alert)}</span>
      <p><b>That didn’t work.</b><br />${e.message}</p>
    </div>`;

  /* ------------------------------------------------------------------ form helper */
  // fields: [{ name, label, type: text|money|date|number|select|textarea|check|file, options, help, required, full, placeholder, list }]
  function fieldHtml(f, v) {
    const val = v === undefined || v === null ? "" : v;
    const label = html`<span class="l"
      >${f.label}${f.required ? html` <span class="req">*</span>` : ""}</span
    >`;
    let control;
    if (f.type === "select")
      control = html`<select class="select" name="${f.name}">
        ${f.options.map((o) => {
          const [k, l] = Array.isArray(o) ? o : [o, o];
          return html`<option
            value="${k}"
            ${String(k) === String(val) ? raw("selected") : ""}
          >
            ${l}
          </option>`;
        })}
      </select>`;
    else if (f.type === "textarea")
      control = html`<textarea
        class="textarea"
        name="${f.name}"
        placeholder="${f.placeholder || ""}"
      >
${val}</textarea
      >`;
    else if (f.type === "money")
      control = html`<div class="money-in">
        <input
          class="input"
          name="${f.name}"
          inputmode="decimal"
          autocomplete="off"
          placeholder="0.00"
          value="${f.type === "money" ? fromCents(v) : val}"
        />
      </div>`;
    else if (f.type === "date")
      control = html`<input
        class="input"
        type="date"
        name="${f.name}"
        value="${val}"
      />`;
    else if (f.type === "file")
      control = html`<input
        class="input"
        type="file"
        name="${f.name}"
        accept=".pdf,.png,.jpg,.jpeg,.webp,.docx,.xlsx,.csv,.txt"
      />`;
    else if (f.type === "check")
      return html`<label class="check full"
        ><input
          type="checkbox"
          name="${f.name}"
          ${v ? raw("checked") : ""}
        /><span><b>${f.label}</b><small>${f.help || ""}</small></span></label
      >`;
    else
      control = html`<input
        class="input"
        name="${f.name}"
        autocomplete="off"
        ${f.list ? raw(`list="${f.list}"`) : ""}
        placeholder="${f.placeholder || ""}"
        value="${val}"
        ${f.type === "number" ? raw('inputmode="decimal"') : ""}
      />`;
    return html`<label class="field ${f.full ? "full" : ""}" data-f="${f.name}"
      >${label}${control}${f.help
        ? html`<span class="help">${f.help}</span>`
        : ""}<span class="err" data-err hidden></span
    ></label>`;
  }
  function collect(form, fields) {
    const out = {};
    const bad = {};
    for (const f of fields) {
      const el = form.elements[f.name];
      if (!el) continue;
      if (f.type === "check") out[f.name] = el.checked;
      else if (f.type === "file")
        out[f.name] = el.files && el.files[0] ? el.files[0] : null;
      else if (f.type === "money") {
        const c = toCents(el.value);
        if (Number.isNaN(c)) bad[f.name] = "Enter an amount like 1250.00";
        else out[f.name] = c;
      } else out[f.name] = el.value;
    }
    return { out, bad };
  }
  function showErrors(form, errs, general) {
    form.querySelectorAll("[data-f]").forEach((l) => {
      l.classList.remove("has-error");
      const s = $(l, "[data-err]");
      s.hidden = true;
      s.textContent = "";
    });
    let first = null;
    const leftover = [];
    for (const [k, m] of Object.entries(errs || {})) {
      const l = form.querySelector(`[data-f="${k}"]`);
      if (l) {
        l.classList.add("has-error");
        const s = $(l, "[data-err]");
        s.textContent = m;
        s.hidden = false;
        first = first || l;
      } else leftover.push(m);
    }
    const box = $(form, "[data-form-error]");
    const msg = [general, ...leftover].filter(Boolean).join(" ");
    box.innerHTML = msg
      ? String(html`<div class="form-error">${msg}</div>`)
      : "";
    if (first) {
      const i = first.querySelector("input,select,textarea");
      if (i) i.focus();
    }
  }
  let formSeq = 0;
  /** Opens a drawer with a form. onSubmit(values, form) must throw FCV.ApiError (or any Error) to keep the drawer open. */
  function formDrawer({
    title,
    subtitle,
    fields,
    values = {},
    submitLabel = "Save",
    onSubmit,
    extra = "",
    footExtra = "",
    wide = false,
    bodyTop = "",
  }) {
    const id = "f" + ++formSeq;
    const d = F.drawer.open({
      title,
      subtitle,
      wide,
      body: html`${bodyTop}
        <form id="${id}" novalidate class="form-grid">
          ${fields.map((f) => fieldHtml(f, values[f.name]))}${extra}
          <div class="full" data-form-error></div>
        </form>`,
      footer: html`${footExtra}<span class="spacer"></span
        ><button class="btn" type="button" data-close-btn>Cancel</button
        ><button class="btn gold" type="submit" form="${id}" data-save>
          ${submitLabel}
        </button>`,
    });
    const form = d.el.querySelector("form");
    const save = d.el.querySelector("[data-save]");
    d.el.querySelector("[data-close-btn]").onclick = () => d.close();
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const { out, bad } = collect(form, fields);
      if (Object.keys(bad).length) return showErrors(form, bad);
      showErrors(form, {});
      save.disabled = true;
      const label = save.textContent;
      save.textContent = "Saving…";
      try {
        await onSubmit(out, form, d);
      } catch (ex) {
        save.disabled = false;
        save.textContent = label;
        showErrors(
          form,
          ex.details,
          ex.details
            ? "Please fix the highlighted fields."
            : ex.message || "Something went wrong.",
        );
      }
    });
    return d;
  }
  const readFile = (file) =>
    new Promise((res, rej) => {
      const r = new FileReader();
      r.onload = () => res(String(r.result).split(",")[1] || "");
      r.onerror = () => rej(new Error("Could not read that file."));
      r.readAsDataURL(file);
    });

  /* ------------------------------------------------------------- tracker table forms */
  const FORMS = {
    "budget-lines": (b) => ({
      label: "budget line",
      fields: [
        { name: "code", label: "Item code", placeholder: "P1-01" },
        { name: "category", label: "Category / trade", required: true },
        { name: "quantity", label: "Quantity", type: "number", required: true },
        { name: "unit", label: "Unit", placeholder: "sq ft, lot, ea…" },
        {
          name: "unitPriceCents",
          label: "Unit price",
          type: "money",
          required: true,
        },
        {
          name: "wastePercent",
          label: "Waste / overage %",
          type: "number",
          help: "Added on top of quantity × price.",
        },
        {
          name: "basis",
          label: "Basis / source",
          full: true,
          placeholder: "Takeoff, vendor quote, allowance…",
        },
      ],
    }),
    expenses: (b) => ({
      label: "expense",
      attach: "receipt",
      fields: [
        {
          name: "purchasedOn",
          label: "Purchase date",
          type: "date",
          required: true,
        },
        {
          name: "amountCents",
          label: "Amount paid",
          type: "money",
          required: true,
        },
        { name: "vendor", label: "Vendor / supplier", required: true },
        { name: "budgetCategory", label: "Budget category", list: "cats" },
        {
          name: "description",
          label: "What was purchased",
          required: true,
          full: true,
        },
        {
          name: "receiptRef",
          label: "Receipt number or link",
          full: true,
          help: "Optional. You can also attach the receipt file itself below.",
        },
        {
          name: "notes",
          label: "Notes / verification",
          type: "textarea",
          full: true,
        },
        {
          name: "receiptFile",
          label: "Attach receipt (PDF, photo, etc.)",
          type: "file",
          full: true,
        },
      ],
    }),
    supplements: (b) => ({
      label: "supplement",
      attach: "supporting",
      fields: [
        { name: "scope", label: "Scope / reason", required: true, full: true },
        { name: "vendorTrade", label: "Vendor / trade" },
        {
          name: "amountCents",
          label: "Amount requested",
          type: "money",
          required: true,
        },
        {
          name: "status",
          label: "Status",
          type: "select",
          options: SUP_STATUS,
          required: true,
          help: "Nothing is “Approved” until you can record the proof of approval.",
        },
        { name: "requestedOn", label: "Date submitted", type: "date" },
        {
          name: "approvalEvidence",
          label: "Proof of approval",
          type: "textarea",
          full: true,
          help: "Required for Approved: who approved it, when, and where the signed approval is kept.",
        },
        {
          name: "approvedOn",
          label: "Approval date",
          type: "date",
          help: "Defaults to today when you mark it Approved.",
        },
        { name: "supportRef", label: "Supporting link or reference" },
        { name: "notes", label: "Notes", type: "textarea", full: true },
        {
          name: "receiptFile",
          label: "Attach supporting document",
          type: "file",
          full: true,
        },
      ],
    }),
    draws: (b) => ({
      label: "draw request",
      attach: "supporting",
      fields: [
        {
          name: "purpose",
          label: "Purpose / phase",
          required: true,
          full: true,
        },
        {
          name: "amountRequestedCents",
          label: "Amount requested",
          type: "money",
          required: true,
        },
        {
          name: "status",
          label: "Status",
          type: "select",
          options: DRAW_STATUS,
          required: true,
        },
        { name: "requestedOn", label: "Date submitted", type: "date" },
        {
          name: "amountApprovedCents",
          label: "Amount approved",
          type: "money",
          help: "Only after the lender approves.",
        },
        {
          name: "amountDisbursedCents",
          label: "Amount disbursed",
          type: "money",
          help: "Only money actually paid out.",
        },
        {
          name: "notes",
          label: "Notes / lender reference",
          type: "textarea",
          full: true,
        },
      ],
    }),
    "remaining-items": (b) => ({
      label: "remaining-amount item",
      fields: [
        { name: "category", label: "Category / trade", required: true },
        { name: "amountCents", label: "Amount", type: "money", required: true },
        { name: "note", label: "Note", full: true },
      ],
    }),
  };

  async function uploadFile(projectId, file, meta) {
    return api("POST", `/api/projects/${projectId}/documents`, {
      ...meta,
      fileName: file.name,
      dataBase64: await readFile(file),
    });
  }

  /* ---------------------------------------------------------------- project page */
  async function showProject(view, id, tab) {
    mount(
      view,
      html`<div class="stack">
        <div class="skel" style="height:150px"></div>
        <div class="skel" style="height:260px"></div>
      </div>`,
    );
    let bundle;
    const load = async () => {
      bundle = await api("GET", `/api/projects/${encodeURIComponent(id)}`);
    };
    try {
      await load();
    } catch (e) {
      mount(
        view,
        html`<section class="card" style="text-align:center;padding:56px 24px">
          <h2 class="h2">
            ${e.status === 404
              ? "Project not found"
              : "Could not load the project"}
          </h2>
          <p class="muted" style="margin:10px 0 22px">${e.message}</p>
          <a class="btn gold" href="#/projects"
            >${raw(icons.back)} All projects</a
          >
        </section>`,
      );
      return;
    }
    const route = (t) => history.replaceState(null, "", `#/p/${id}/${t}`);
    const refresh = async (keepScroll = true) => {
      const y = window.scrollY;
      await load();
      draw();
      if (keepScroll) window.scrollTo({ top: y });
    };
    const rec = (entity, rid) =>
      (bundle.tracker[KEY[entity]] || []).find((r) => r.id === rid);

    function draw() {
      const p = bundle.project;
      document.title = `${p.code} · FCV Administration`;
      const cover = html`<button class="btn sm gold" data-act="settings">
        ${raw(icons.edit)} Status &amp; details
      </button>`;
      mount(
        view,
        html`${T.page(bundle, {
          tab,
          admin: true,
          backHref: "#/projects",
          backLabel: "All projects",
          coverActions: cover,
        })}${adminPanel(bundle)}`,
      );
      bind();
    }

    function adminPanel(b) {
      const p = b.project;
      const visible =
        b.tracker &&
        (p.trackerVisible ||
          ["work_in_progress", "completed"].includes(p.stage));
      return html`<div
        class="stack no-print"
        style="--gap:20px;margin-top:22px"
      >
        <section class="card">
          <div class="card-head">
            <div>
              <h3>Client access</h3>
              <div class="muted" style="font-size:.875rem;margin-top:4px">
                Only the people listed here can open this project. They see it
                read-only.
              </div>
            </div>
          </div>
          <div class="stack" style="--gap:14px">
            ${b.members.length
              ? html`<ul class="list plain">
                  ${b.members.map(
                    (m) =>
                      html`<li>
                        <div
                          class="row wrap-r"
                          style="justify-content:space-between"
                        >
                          <span
                            ><b>${m.name || m.email}</b>${m.name
                              ? html` <span class="muted">${m.email}</span>`
                              : ""}
                            ${m.status === "invited"
                              ? html`<span class="chip">Invite pending</span>`
                              : m.status === "disabled"
                                ? html`<span class="chip dim">Disabled</span>`
                                : ""}</span
                          ><button
                            class="btn sm danger"
                            data-act="member-remove"
                            data-email="${m.email}"
                          >
                            Remove
                          </button>
                        </div>
                      </li>`,
                  )}
                </ul>`
              : html`<p class="muted" style="margin:0">
                  Nobody has access yet. Invite the client or lender, then add
                  them here.
                </p>`}
            <form class="row wrap-r" data-member-form novalidate>
              <input
                class="input"
                style="flex:1;min-width:220px"
                name="email"
                type="email"
                placeholder="client@example.com"
                aria-label="Email of person to give access"
              /><button class="btn gold" type="submit">
                ${raw(icons.plus)} Give access</button
              ><a class="btn ghost" href="#/people">Invite someone new</a>
            </form>
            <div data-member-msg></div>
          </div>
        </section>
        <section class="card">
          <div class="card-head">
            <div>
              <h3>History for this project</h3>
              <div class="muted" style="font-size:.875rem;margin-top:4px">
                ${visible
                  ? "Clients and lenders can see the tracker."
                  : "The tracker is hidden from clients until the project reaches “Work in progress”, or you switch it on in Status &amp; details."}
              </div>
            </div>
            <a class="btn sm" href="#/audit/${p.id}"
              >${raw(icons.history)} View audit log</a
            >
          </div>
        </section>
      </div>`;
    }

    function bind() {
      const q = (s) => view.querySelectorAll(s);
      q("[data-tab]").forEach((b) =>
        b.addEventListener("click", () => {
          tab = b.dataset.tab;
          route(tab);
          draw();
          const t = $(view, "#tab-" + tab);
          if (t) t.focus();
        }),
      );
      const tabs = $(view, ".tabs");
      if (tabs)
        tabs.addEventListener("keydown", (e) => {
          if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
          const ks = T.TABS.map((t) => t[0]);
          tab =
            ks[
              (ks.indexOf(tab) +
                (e.key === "ArrowRight" ? 1 : -1) +
                ks.length) %
                ks.length
            ];
          route(tab);
          draw();
          $(view, "#tab-" + tab).focus();
        });
      const pr = $(view, "[data-act=print]");
      if (pr) pr.onclick = () => window.print();
      q("[data-act]").forEach((el) => {
        const a = el.dataset.act;
        if (a === "print") return;
        el.addEventListener("click", () => act(a, el.dataset));
      });
      const mf = $(view, "[data-member-form]");
      if (mf)
        mf.addEventListener("submit", async (e) => {
          e.preventDefault();
          const email = mf.email.value.trim();
          if (!email) return;
          try {
            await api("POST", `/api/projects/${id}/members`, { email });
            toast("Access granted.", "ok");
            await refresh();
          } catch (ex) {
            $(view, "[data-member-msg]").innerHTML = String(errBox(ex));
          }
        });
    }

    async function act(a, ds) {
      if (a === "settings") return settings();
      if (a === "add") return entityForm(ds.entity, null);
      if (a === "edit") return entityForm(ds.entity, rec(ds.entity, ds.id));
      if (a === "delete") {
        const r = rec(ds.entity, ds.id);
        const name =
          r.expenseRef ||
          r.supplementRef ||
          r.drawRef ||
          r.category ||
          r.vendor ||
          "this record";
        if (
          !(await F.confirm({
            title: "Delete this record?",
            message: `“${name}” will be removed from the tracker. This is recorded in the audit log. Attached files are kept.`,
            confirmLabel: "Delete",
            danger: true,
          }))
        )
          return;
        try {
          await api("DELETE", `/api/projects/${id}/${ds.entity}/${ds.id}`);
          toast("Deleted.", "ok");
          await refresh();
        } catch (e) {
          toast(e.message, "bad");
        }
        return;
      }
      if (a === "attach") return attach(ds.linkType, ds.linkId);
      if (a === "upload") return attach(null, null);
      if (a === "doc-delete") {
        if (
          !(await F.confirm({
            title: "Delete this document?",
            message:
              "The file is permanently removed and can no longer be downloaded. This is recorded in the audit log.",
            confirmLabel: "Delete file",
            danger: true,
          }))
        )
          return;
        try {
          await api("DELETE", `/api/documents/${ds.id}`);
          toast("Document deleted.", "ok");
          await refresh();
        } catch (e) {
          toast(e.message, "bad");
        }
        return;
      }
      if (a === "member-remove") {
        if (
          !(await F.confirm({
            title: "Remove access?",
            message: `${ds.email} will no longer be able to open this project.`,
            confirmLabel: "Remove",
            danger: true,
          }))
        )
          return;
        try {
          await api(
            "DELETE",
            `/api/projects/${id}/members/${encodeURIComponent(ds.email)}`,
          );
          toast("Access removed.", "ok");
          await refresh();
        } catch (e) {
          toast(e.message, "bad");
        }
      }
    }

    function entityForm(entity, record) {
      const spec = FORMS[entity](bundle);
      const t = bundle.tracker;
      const cats = [
        ...new Set(
          t.budgetLines
            .map((l) => l.category)
            .concat(t.remaining.map((r) => r.category)),
        ),
      ];
      const fields = spec.fields.filter((f) => !(record && f.type === "file"));
      const d = formDrawer({
        title: `${record ? "Edit" : "Add"} ${spec.label}`,
        subtitle: bundle.project.code,
        fields,
        values:
          record ||
          (entity === "budget-lines"
            ? { wastePercent: "0.00" }
            : entity === "draws"
              ? { status: "Proposed - not submitted" }
              : entity === "supplements"
                ? { status: "Draft" }
                : {}),
        extra: html`<datalist id="cats">
          ${cats.map((c) => html`<option value="${c}"></option>`)}
        </datalist>`,
        submitLabel: record ? "Save changes" : `Add ${spec.label}`,
        onSubmit: async (v) => {
          const file = v.receiptFile;
          delete v.receiptFile;
          const res = record
            ? await api(
                "PATCH",
                `/api/projects/${id}/${entity}/${record.id}`,
                v,
              )
            : await api("POST", `/api/projects/${id}/${entity}`, v);
          let msg = record ? "Changes saved." : "Added.";
          if (file) {
            try {
              await uploadFile(id, file, {
                title: file.name.replace(/\.[^.]+$/, ""),
                kind: spec.attach,
                linkedType: LINK[entity],
                linkedId: res.record.id,
              });
              msg += " File attached.";
            } catch (e) {
              toast(
                `Saved, but the file was not attached: ${e.message}`,
                "bad",
              );
            }
          }
          d.close(true);
          toast(msg, "ok");
          await refresh();
        },
      });
      if (entity === "supplements" || entity === "draws") {
        // show only the fields that make sense for the chosen status
        const form = d.el.querySelector("form");
        const st = form.elements.status;
        const toggle = () => {
          const s = st.value;
          const show = (n, on) => {
            const el = form.querySelector(`[data-f="${n}"]`);
            if (!el) return;
            el.hidden = !on;
            if (!on) {
              const i = el.querySelector("input,textarea");
              if (i) i.value = "";
            }
          };
          if (entity === "supplements") {
            show("approvalEvidence", s === "Approved");
            show("approvedOn", s === "Approved");
          } else {
            show(
              "amountApprovedCents",
              !["Proposed - not submitted", "Submitted", "Rejected"].includes(
                s,
              ),
            );
            show(
              "amountDisbursedCents",
              ["Partially funded", "Funded"].includes(s),
            );
          }
        };
        st.addEventListener("change", toggle);
        toggle();
      }
    }

    function attach(linkType, linkId) {
      const t = bundle.tracker;
      const targets = [
        ["", "Whole project (contract, photos, etc.)"],
        ...t.expenses.map((e) => [
          `expense:${e.id}`,
          `Expense · ${e.expenseRef || ""} ${e.vendor}`,
        ]),
        ...t.supplements.map((s) => [
          `supplement:${s.id}`,
          `Supplement · ${s.supplementRef || ""} ${s.scope.slice(0, 40)}`,
        ]),
        ...t.draws.map((r) => [
          `draw:${r.id}`,
          `Draw · ${r.drawRef || ""} ${r.purpose.slice(0, 40)}`,
        ]),
      ];
      const fields = [
        {
          name: "file",
          label: "File",
          type: "file",
          required: true,
          full: true,
          help: "PDF, photo, Word, Excel, CSV or text. Up to 4 MB.",
        },
        {
          name: "title",
          label: "Title",
          required: true,
          full: true,
          placeholder: "e.g. Lakeview Lumber invoice",
        },
        { name: "kind", label: "Type", type: "select", options: DOC_KINDS },
        {
          name: "target",
          label: "Belongs to",
          type: "select",
          options: targets,
        },
      ];
      const d = formDrawer({
        title: "Upload a document",
        subtitle: bundle.project.code,
        fields,
        values: {
          kind:
            linkType === "expense"
              ? "receipt"
              : linkType
                ? "supporting"
                : "supporting",
          target: linkType ? `${linkType}:${linkId}` : "",
        },
        submitLabel: "Upload",
        onSubmit: async (v) => {
          if (!v.file)
            throw Object.assign(new Error("Choose a file."), {
              details: { file: "Choose a file to upload." },
            });
          const [lt, li] = v.target
            ? v.target.split(":")
            : [undefined, undefined];
          await uploadFile(id, v.file, {
            title: v.title,
            kind: v.kind,
            linkedType: lt,
            linkedId: li,
          });
          d.close(true);
          toast("Document uploaded.", "ok");
          await refresh();
        },
      });
      const form = d.el.querySelector("form");
      form.elements.file.addEventListener("change", () => {
        if (!form.elements.title.value && form.elements.file.files[0])
          form.elements.title.value = form.elements.file.files[0].name.replace(
            /\.[^.]+$/,
            "",
          );
      });
    }

    function settings() {
      const p = bundle.project;
      const fields = [
        {
          name: "stage",
          label: "Stage (what the client sees on their tracker)",
          type: "select",
          options: STAGES,
          full: true,
          help: "Saving a new stage also updates the Quote Status in your Google Sheet.",
        },
        { name: "workStartDate", label: "Work can start from", type: "date" },
        {
          name: "baseEstimateCents",
          label: "Total estimate / quote",
          type: "money",
          help: "Shown to the client once the quote is ready.",
        },
        {
          name: "clientMessage",
          label: "Note to the client",
          type: "textarea",
          full: true,
          help: "Appears at the top of their project page. Plain text.",
        },
        {
          name: "trackerVisible",
          label: "Show the project tracker to clients now",
          type: "check",
          help: "It always appears automatically at “Work in progress” and “Work completed”.",
        },
        { name: "title", label: "Project title", required: true, full: true },
        { name: "code", label: "Project code", required: true },
        { name: "clientName", label: "Client name", required: true },
        { name: "address", label: "Property address", full: true },
        {
          name: "phaseLabel",
          label: "Phase label",
          placeholder: "Phase 1 — Initial scope",
        },
        { name: "lenderStatus", label: "Lender status" },
        { name: "estimateSource", label: "Estimate source", full: true },
        {
          name: "notesText",
          label: "Project notes (one per line)",
          type: "textarea",
          full: true,
          help: "Shown on the Lender Summary tab.",
        },
      ];
      const delBtn = html`<button class="btn danger" type="button" data-del>
        ${raw(icons.trash)} Delete project
      </button>`;
      const d = formDrawer({
        title: "Status & details",
        subtitle: p.code,
        fields,
        wide: true,
        values: { ...p, notesText: (p.notes || []).join("\n") },
        submitLabel: "Save changes",
        footExtra: delBtn,
        onSubmit: async (v) => {
          const body = {
            ...v,
            notes: String(v.notesText || "")
              .split("\n")
              .map((s) => s.trim())
              .filter(Boolean),
          };
          delete body.notesText;
          const r = await api("PATCH", `/api/projects/${id}`, body);
          d.close(true);
          toast(
            !r.changed
              ? "Nothing changed."
              : r.sheetSync === "failed"
                ? "Saved. The Google Sheet could not be updated, so check the connection (see System check)."
                : r.sheetSync === "synced"
                  ? "Saved and synced to your sheet."
                  : "Saved.",
            r.sheetSync === "failed" ? "bad" : "ok",
          );
          await refresh();
        },
      });
      d.el.querySelector("[data-del]").onclick = async () => {
        if (
          !(await F.confirm({
            title: "Delete this entire project?",
            message:
              "All budget lines, expenses, supplements, draws and files for this project are permanently deleted. The audit log keeps a record that it happened. This cannot be undone.",
            confirmLabel: "Delete project",
            danger: true,
            requireText: p.code,
          }))
        )
          return;
        try {
          await api("DELETE", `/api/projects/${id}`, { confirmCode: p.code });
          d.close(true);
          toast("Project deleted.", "ok");
          location.hash = "#/projects";
        } catch (e) {
          toast(e.message, "bad");
        }
      };
    }
    draw();
    window.scrollTo({ top: 0 });
  }

  /* ---------------------------------------------------------------- project list */
  async function showProjects(view) {
    document.title = "Projects · FCV Administration";
    mount(view, html`<div class="skel" style="height:300px"></div>`);
    let list;
    try {
      list = (await api("GET", "/api/projects")).projects;
    } catch (e) {
      mount(view, errBox(e));
      return;
    }
    let filter = "all";
    let term = "";
    const counts = (k) =>
      list.filter(
        (p) =>
          k === "all" ||
          (k === "active"
            ? ["accepted", "work_in_progress"].includes(p.stage)
            : k === "open"
              ? ["new", "contacted", "site_visit", "quote_sent"].includes(
                  p.stage,
                )
              : p.stage === k),
      ).length;
    const FILT = [
      ["all", "All"],
      ["open", "Open requests"],
      ["active", "Active"],
      ["completed", "Completed"],
      ["declined", "Closed"],
    ];
    const rows = () =>
      list.filter(
        (p) =>
          (filter === "all" ||
            (filter === "active"
              ? ["accepted", "work_in_progress"].includes(p.stage)
              : filter === "open"
                ? ["new", "contacted", "site_visit", "quote_sent"].includes(
                    p.stage,
                  )
                : p.stage === filter)) &&
          (!term ||
            `${p.code} ${p.title} ${p.clientName} ${p.address}`
              .toLowerCase()
              .includes(term)),
      );
    const body = () => {
      const r = rows();
      return r.length
        ? html`<table class="t">
            <thead>
              <tr>
                <th>Project</th>
                <th>Client</th>
                <th>Stage</th>
                <th class="r">Estimate</th>
                <th class="r">Disbursed</th>
                <th>Updated</th>
              </tr>
            </thead>
            <tbody>
              ${r.map(
                (p) =>
                  html`<tr style="cursor:pointer" data-open="${p.id}">
                    <td>
                      <a href="#/p/${p.id}"><b>${p.title}</b></a
                      ><span
                        class="code"
                        style="display:inline-block;margin-top:6px"
                        >${p.code}</span
                      >
                    </td>
                    <td>
                      ${p.clientName}<span class="sub">${p.address}</span>
                    </td>
                    <td>${stageChip(p.stage)}</td>
                    <td class="r num">
                      ${p.baseEstimateCents != null
                        ? money(p.baseEstimateCents)
                        : "—"}
                    </td>
                    <td class="r num">
                      ${p.summary ? money(p.summary.draws.disbursedCents) : "—"}
                    </td>
                    <td class="muted" style="white-space:nowrap">
                      ${ago(p.updatedAt)}
                    </td>
                  </tr>`,
              )}
            </tbody>
          </table>`
        : html`<div class="empty">
            ${raw(icons.building)}<b>No projects match</b>
            <p style="margin:0">
              Try another filter, or create a project from a quote request or
              the tracker workbook.
            </p>
          </div>`;
    };
    const draw = () => {
      mount(
        view,
        html`<div class="section-head" style="margin-top:0">
            <div>
              <div class="eyebrow">Administration</div>
              <h1 class="display" style="margin-top:10px">Projects</h1>
            </div>
            <div class="row wrap-r">
              <a class="btn" href="#/import"
                >${raw(icons.upload)} Import tracker workbook</a
              ><button class="btn gold" data-new>
                ${raw(icons.plus)} New project
              </button>
            </div>
          </div>
          <div class="stat-row">
            <div class="kpi">
              <div class="k">Projects</div>
              <div class="v num">${list.length}</div>
            </div>
            <div class="kpi">
              <div class="k">Open requests</div>
              <div class="v num">${counts("open")}</div>
            </div>
            <div class="kpi">
              <div class="k">Active jobs</div>
              <div class="v num">${counts("active")}</div>
            </div>
            <div class="kpi">
              <div class="k">Completed</div>
              <div class="v num">${counts("completed")}</div>
            </div>
          </div>
          <div class="toolbar">
            <div class="pillbar" role="group" aria-label="Filter">
              ${FILT.map(
                ([k, l]) =>
                  html`<button
                    type="button"
                    data-f="${k}"
                    aria-pressed="${String(k === filter)}"
                  >
                    ${l} <span class="faint">${counts(k)}</span>
                  </button>`,
              )}
            </div>
            <div class="search grow">
              ${raw(icons.search)}<input
                class="input"
                id="q"
                placeholder="Search by project, client or address"
                value="${term}"
                aria-label="Search projects"
              />
            </div>
          </div>
          <section class="card pad-0">
            <div class="table-wrap" id="rows">${body()}</div>
          </section>`,
      );
      view.querySelectorAll("[data-f]").forEach(
        (b) =>
          (b.onclick = () => {
            filter = b.dataset.f;
            draw();
          }),
      );
      const qi = $(view, "#q");
      qi.oninput = () => {
        term = qi.value.trim().toLowerCase();
        $(view, "#rows").innerHTML = String(body());
        wireRows();
      };
      $(view, "[data-new]").onclick = newProject;
      wireRows();
    };
    const wireRows = () =>
      view.querySelectorAll("[data-open]").forEach(
        (tr) =>
          (tr.onclick = (e) => {
            if (!e.target.closest("a"))
              location.hash = "#/p/" + tr.dataset.open;
          }),
      );
    const newProject = () => {
      const d = formDrawer({
        title: "New project",
        subtitle:
          "Add the basics. You can fill in budget lines, draws and expenses afterwards.",
        submitLabel: "Create project",
        values: {
          stage: "new",
          lenderStatus: "Preliminary / not lender-approved",
        },
        fields: [
          {
            name: "title",
            label: "Project title",
            required: true,
            full: true,
            placeholder: "ADU build — Phase 1",
          },
          {
            name: "code",
            label: "Project code",
            required: true,
            placeholder: "FCV-AB-ADU-01",
            help: "Letters, numbers and dashes.",
          },
          { name: "clientName", label: "Client name", required: true },
          { name: "address", label: "Property address", full: true },
          { name: "stage", label: "Stage", type: "select", options: STAGES },
          { name: "baseEstimateCents", label: "Total estimate", type: "money" },
          { name: "lenderStatus", label: "Lender status", full: true },
        ],
        onSubmit: async (v) => {
          const r = await api("POST", "/api/projects", v);
          d.close(true);
          toast("Project created.", "ok");
          location.hash = "#/p/" + r.project.id;
        },
      });
    };
    draw();
  }

  /* ------------------------------------------------------------ quote requests */
  async function showRequests(view) {
    document.title = "Quote requests · FCV Administration";
    mount(view, html`<div class="skel" style="height:300px"></div>`);
    let data;
    try {
      data = await api("GET", "/api/admin/requests");
    } catch (e) {
      mount(
        view,
        html`<div class="section-head" style="margin-top:0">
            <div>
              <div class="eyebrow">Administration</div>
              <h1 class="display" style="margin-top:10px">Quote requests</h1>
            </div>
          </div>
          ${errBox(e)}
          <p class="muted" style="margin-top:14px">
            If the sheet is not connected yet, open
            <a href="#/people">People &amp; invitations</a> → System check for
            what is missing.
          </p>`,
      );
      return;
    }
    let tab = "quotes";
    let term = "";
    const quotes = data.quotes
      .slice()
      .sort((a, b) =>
        String(b["Submitted At"]).localeCompare(String(a["Submitted At"])),
      );
    const statusChip = (s) =>
      html`<span
        class="chip ${s === "Declined"
          ? "dim"
          : /Quote|Accepted|Progress|Completed/.test(s)
            ? "gold"
            : ""}"
        >${s || "New"}</span
      >`;
    const tbl = () => {
      const t = term.toLowerCase();
      if (tab === "quotes") {
        const r = quotes.filter(
          (q) =>
            !t ||
            `${q.Reference} ${q.Name} ${q.Email} ${q["Selected Items"]}`
              .toLowerCase()
              .includes(t),
        );
        return r.length
          ? html`<table class="t">
              <thead>
                <tr>
                  <th>Request</th>
                  <th>Contact</th>
                  <th>Selections</th>
                  <th class="r">Estimate</th>
                  <th>Status</th>
                  <th class="r">Portal</th>
                </tr>
              </thead>
              <tbody>
                ${r.map(
                  (q) =>
                    html`<tr style="cursor:pointer" data-ref="${q.Reference}">
                      <td>
                        <b class="code">${q.Reference}</b
                        ><span class="sub">${ago(q["Submitted At"])}</span>
                      </td>
                      <td>
                        <b>${q.Name}</b><span class="sub">${q.Email}</span>
                      </td>
                      <td>
                        ${q["Item Count"] || 0} item(s)<span class="sub"
                          >${String(q["Selected Items"] || "").slice(
                            0,
                            70,
                          )}</span
                        >
                      </td>
                      <td class="r num">
                        ${q["Actual Price"] !== "" && q["Actual Price"] != null
                          ? money(Math.round(Number(q["Actual Price"]) * 100))
                          : html`<span class="muted"
                              >${q["Estimate Range (shown to customer)"] ||
                              "—"}</span
                            >`}
                      </td>
                      <td>${statusChip(q["Quote Status"])}</td>
                      <td class="r">
                        ${q.project
                          ? html`<a class="btn sm" href="#/p/${q.project.id}"
                              >Open ${q.project.code}</a
                            >`
                          : html`<button
                              class="btn sm gold"
                              data-create="${q.Reference}"
                            >
                              Create project
                            </button>`}
                      </td>
                    </tr>`,
                )}
              </tbody>
            </table>`
          : html`<div class="empty">
              ${raw(icons.inbox)}<b>No requests found</b>
            </div>`;
      }
      const r = data.contacts.filter(
        (c) =>
          !t || `${c.Name} ${c.Email} ${c.Message}`.toLowerCase().includes(t),
      );
      return r.length
        ? html`<table class="t">
            <thead>
              <tr>
                <th>Message</th>
                <th>Contact</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              ${r.map(
                (c) =>
                  html`<tr style="cursor:pointer" data-cref="${c.Reference}">
                    <td>
                      <b>${c.Subject || "General enquiry"}</b
                      ><span class="sub"
                        >${String(c.Message || "").slice(0, 90)}</span
                      >
                    </td>
                    <td>
                      ${c.Name}<span class="sub">${c.Phone} · ${c.Email}</span>
                    </td>
                    <td>${statusChip(c["Quote Status"])}</td>
                  </tr>`,
              )}
            </tbody>
          </table>`
        : html`<div class="empty">
            ${raw(icons.inbox)}<b>No messages found</b>
          </div>`;
    };
    const draw = () => {
      mount(
        view,
        html`<div class="section-head" style="margin-top:0">
            <div>
              <div class="eyebrow">Administration</div>
              <h1 class="display" style="margin-top:10px">Quote requests</h1>
              <p class="muted" style="margin:10px 0 0">
                Live from your Google Sheet. Edits here are written back to the
                sheet.
              </p>
            </div>
          </div>
          <div class="toolbar">
            <div class="pillbar">
              <button
                data-t="quotes"
                aria-pressed="${String(tab === "quotes")}"
              >
                Quote requests
                <span class="faint">${quotes.length}</span></button
              ><button
                data-t="contacts"
                aria-pressed="${String(tab === "contacts")}"
              >
                Contact messages
                <span class="faint">${data.contacts.length}</span>
              </button>
            </div>
            <div class="search grow">
              ${raw(icons.search)}<input
                class="input"
                id="q"
                value="${term}"
                placeholder="Search name, email, reference…"
                aria-label="Search"
              />
            </div>
          </div>
          <section class="card pad-0">
            <div class="table-wrap" id="rows">${tbl()}</div>
          </section>`,
      );
      view.querySelectorAll("[data-t]").forEach(
        (b) =>
          (b.onclick = () => {
            tab = b.dataset.t;
            draw();
          }),
      );
      const qi = $(view, "#q");
      qi.oninput = () => {
        term = qi.value.trim();
        $(view, "#rows").innerHTML = String(tbl());
        wire();
      };
      wire();
    };
    const wire = () => {
      view.querySelectorAll("[data-ref]").forEach(
        (tr) =>
          (tr.onclick = (e) => {
            if (e.target.closest("a,button")) return;
            detail(
              quotes.find((q) => q.Reference === tr.dataset.ref),
              "quote",
            );
          }),
      );
      view.querySelectorAll("[data-cref]").forEach(
        (tr) =>
          (tr.onclick = () =>
            detail(
              data.contacts.find((c) => c.Reference === tr.dataset.cref),
              "contact",
            )),
      );
      view.querySelectorAll("[data-create]").forEach(
        (b) =>
          (b.onclick = (e) => {
            e.stopPropagation();
            createFrom(quotes.find((q) => q.Reference === b.dataset.create));
          }),
      );
    };
    function detail(q, kind) {
      const isQ = kind === "quote";
      const phone = String(q.Phone || "").replace(/[^\d+]/g, "");
      const info = isQ
        ? html`<dl class="kv">
            <dt>Property</dt>
            <dd>
              ${[q["Property Address"], q.City, q.ZIP]
                .filter(Boolean)
                .join(", ") || "—"}
              <span class="muted">${q["Property Type"]}</span>
            </dd>
            <dt>Selections</dt>
            <dd>
              ${String(q["Selected Items"] || "—")
                .split(/\s*;\s*/)
                .map((s) => html`<div>${s}</div>`)}
            </dd>
            ${q["Site-Visit Items"]
              ? html`<dt>Needs a site visit</dt>
                  <dd>${q["Site-Visit Items"]}</dd>`
              : ""}
            <dt>Finish · Timeline</dt>
            <dd>${q["Finish Level"] || "—"} · ${q["Start Timeline"] || "—"}</dd>
            <dt>Insurance claim</dt>
            <dd>${q["Insurance Claim"] || "—"}</dd>
            <dt>Customer estimate</dt>
            <dd>${q["Estimate Range (shown to customer)"] || "—"}</dd>
            <dt>Customer notes</dt>
            <dd>${q.Notes || "—"}</dd>
          </dl>`
        : html`<dl class="kv">
            <dt>Subject</dt>
            <dd>${q.Subject || "—"}</dd>
            <dt>Message</dt>
            <dd style="white-space:pre-wrap">${q.Message || "—"}</dd>
          </dl>`;
      const fields = isQ
        ? [
            {
              name: "Quote Status",
              label: "Quote status",
              type: "select",
              options: data.statusOptions.length
                ? data.statusOptions
                : Object.values({
                    a: "New",
                    b: "Contacted",
                    c: "Site Visit Scheduled",
                    d: "Quote Sent",
                    e: "Accepted",
                    f: "Work in Progress",
                    g: "Completed",
                    h: "Declined",
                  }),
            },
            {
              name: "Actual Price",
              label: "Actual price ($)",
              type: "number",
              help: "The quote after the site visit.",
            },
            {
              name: "Work Start Date",
              label: "Work can start from",
              type: "date",
            },
            {
              name: "Client Message",
              label: "Note to the client",
              type: "textarea",
              full: true,
            },
            {
              name: "Internal Notes",
              label: "Internal notes (never shown to the client)",
              type: "textarea",
              full: true,
            },
          ]
        : [
            {
              name: "Quote Status",
              label: "Status",
              type: "select",
              options: data.statusOptions.length
                ? data.statusOptions
                : ["New", "Contacted", "Completed"],
            },
            {
              name: "Internal Notes",
              label: "Internal notes",
              type: "textarea",
              full: true,
            },
          ];
      const d = formDrawer({
        title: q.Name,
        subtitle: `${q.Reference} · ${ago(q["Submitted At"])}`,
        wide: true,
        fields,
        values: q,
        submitLabel: "Save to sheet",
        bodyTop: html`<div class="row wrap-r" style="margin-bottom:18px">
            ${phone
              ? html`<a class="btn sm" href="tel:${phone}"
                  >${raw(icons.phone)} Call ${q.Phone}</a
                >`
              : ""}${q.Email
              ? html`<a class="btn sm" href="mailto:${q.Email}"
                  >${raw(icons.mail)} Email</a
                >`
              : ""}
          </div>
          ${info}
          <hr
            style="border:0;border-top:1px solid var(--line);margin:22px 0"
          />`,
        onSubmit: async (v) => {
          const body = {};
          for (const [k, x] of Object.entries(v))
            if (String(x ?? "") !== String(q[k] ?? "")) body[k] = x;
          if (!Object.keys(body).length) {
            d.close(true);
            return;
          }
          await api(
            "PATCH",
            `/api/admin/requests/${encodeURIComponent(q.Reference)}`,
            { tab: isQ ? "quote" : "contact", fields: body },
          );
          Object.assign(q, body);
          d.close(true);
          toast("Saved to your sheet.", "ok");
          draw();
        },
      });
    }
    function createFrom(q) {
      const d = formDrawer({
        title: "Create a portal project",
        subtitle: `From ${q.Reference} · ${q.Name}`,
        submitLabel: "Create project",
        values: {
          code: q.Reference,
          title: `Renovation for ${q.Name}`,
          stage: "new",
        },
        fields: [
          { name: "title", label: "Project title", required: true, full: true },
          {
            name: "code",
            label: "Project code",
            required: true,
            help: "Defaults to the request number.",
          },
          { name: "stage", label: "Stage", type: "select", options: STAGES },
        ],
        bodyTop: html`<div class="callout">
            <span>${raw(icons.info)}</span>
            <p>
              The client’s selections are copied across. Their phone number and
              email are <b>not</b>. Next, invite them from People &amp;
              invitations and give them access to the project.
            </p>
          </div>
          <div style="height:16px"></div>`,
        onSubmit: async (v) => {
          const r = await api(
            "POST",
            `/api/admin/requests/${encodeURIComponent(q.Reference)}/project`,
            v,
          );
          d.close(true);
          toast("Project created.", "ok");
          location.hash = "#/p/" + r.project.id;
        },
      });
    }
    draw();
  }

  /* --------------------------------------------------------------------- people */
  async function showPeople(view) {
    document.title = "People & invitations · FCV Administration";
    mount(view, html`<div class="skel" style="height:300px"></div>`);
    let users, projects, health;
    const load = async () => {
      [users, projects] = await Promise.all([
        api("GET", "/api/admin/users"),
        api("GET", "/api/projects").then((r) => r.projects),
      ]);
    };
    try {
      await load();
    } catch (e) {
      mount(view, errBox(e));
      return;
    }
    const status = (u) =>
      u.status === "disabled"
        ? html`<span class="chip dim">Disabled</span>`
        : u.status === "invited" || u.accepted === false
          ? html`<span class="chip">Invite pending</span>`
          : html`<span class="chip gold"
              ><span class="dot"></span>Active</span
            >`;
    const draw = () => {
      mount(
        view,
        html`<div class="section-head" style="margin-top:0">
            <div>
              <div class="eyebrow">Administration</div>
              <h1 class="display" style="margin-top:10px">
                People &amp; invitations
              </h1>
              <p class="muted" style="margin:10px 0 0">
                Accounts are invite-only. Members are read-only and see only the
                projects you assign.
              </p>
            </div>
            <button class="btn gold" data-invite>
              ${raw(icons.mail)} Invite someone
            </button>
          </div>
          <section class="card pad-0">
            <div class="table-wrap">
              <table class="t">
                <thead>
                  <tr>
                    <th>Person</th>
                    <th>Role</th>
                    <th>Status</th>
                    <th class="r">Projects</th>
                    <th>Last sign-in</th>
                    <th class="r"></th>
                  </tr>
                </thead>
                <tbody>
                  ${users.users.map(
                    (u) =>
                      html`<tr>
                        <td>
                          <b>${u.name || u.email}</b>${u.name
                            ? html`<span class="sub">${u.email}</span>`
                            : ""}
                        </td>
                        <td>
                          ${u.role === "admin"
                            ? html`<span class="chip gold">Administrator</span>`
                            : html`<span class="chip">Read-only member</span>`}
                        </td>
                        <td>${status(u)}</td>
                        <td class="r num">
                          ${u.role === "admin" ? "All" : u.projects}
                        </td>
                        <td class="muted">
                          ${u.lastLoginAt ? ago(u.lastLoginAt) : "Never"}
                        </td>
                        <td class="r">
                          ${u.role === "admin"
                            ? ""
                            : html`<div class="row-actions">
                                ${u.status !== "disabled" &&
                                (u.status === "invited" || u.accepted === false)
                                  ? html`<button
                                      class="btn sm"
                                      data-resend="${u.email}"
                                    >
                                      Resend invite
                                    </button>`
                                  : ""}${u.status === "disabled"
                                  ? html`<button
                                      class="btn sm"
                                      data-enable="${u.email}"
                                    >
                                      Re-enable
                                    </button>`
                                  : html`<button
                                      class="btn sm"
                                      data-disable="${u.email}"
                                    >
                                      Disable
                                    </button>`}<button
                                  class="icon-btn danger"
                                  data-remove="${u.email}"
                                  aria-label="Remove ${u.email}"
                                  title="Remove"
                                >
                                  ${raw(icons.trash)}
                                </button>
                              </div>`}
                        </td>
                      </tr>`,
                  )}
                </tbody>
              </table>
            </div>
          </section>
          ${users.identityChecked
            ? ""
            : html`<div class="callout warn" style="margin-top:16px">
                <span>${raw(icons.alert)}</span>
                <p>
                  Could not check invitation status with Netlify Identity just
                  now.
                </p>
              </div>`}
          <div class="section-head">
            <div>
              <h2 class="h2">System check</h2>
              <p class="muted" style="margin:6px 0 0">
                Confirms the portal’s connections are healthy and registration
                is invite-only.
              </p>
            </div>
            <button class="btn" data-health>
              ${raw(icons.refresh)} Run check
            </button>
          </div>
          <section class="card pad-0" id="health" hidden></section>`,
      );
      const call = async (fn, ok) => {
        try {
          await fn();
          toast(ok, "ok");
          await load();
          draw();
        } catch (e) {
          toast(e.message, "bad");
        }
      };
      $(view, "[data-invite]").onclick = invite;
      view
        .querySelectorAll("[data-resend]")
        .forEach(
          (b) =>
            (b.onclick = () =>
              call(
                () =>
                  api(
                    "POST",
                    `/api/admin/users/${encodeURIComponent(b.dataset.resend)}/resend`,
                  ),
                "Invitation sent again.",
              )),
        );
      view.querySelectorAll("[data-disable]").forEach(
        (b) =>
          (b.onclick = async () => {
            if (
              await F.confirm({
                title: "Disable this account?",
                message: `${b.dataset.disable} will be signed out and unable to sign in until you re-enable them.`,
                confirmLabel: "Disable",
                danger: true,
              })
            )
              call(
                () =>
                  api(
                    "POST",
                    `/api/admin/users/${encodeURIComponent(b.dataset.disable)}/disable`,
                  ),
                "Account disabled.",
              );
          }),
      );
      view
        .querySelectorAll("[data-enable]")
        .forEach(
          (b) =>
            (b.onclick = () =>
              call(
                () =>
                  api(
                    "POST",
                    `/api/admin/users/${encodeURIComponent(b.dataset.enable)}/enable`,
                  ),
                "Account re-enabled.",
              )),
        );
      view.querySelectorAll("[data-remove]").forEach(
        (b) =>
          (b.onclick = async () => {
            if (
              await F.confirm({
                title: "Remove this person?",
                message: `${b.dataset.remove} loses access and their login is deleted. This is recorded in the audit log.`,
                confirmLabel: "Remove",
                danger: true,
              })
            )
              call(
                () =>
                  api(
                    "DELETE",
                    `/api/admin/users/${encodeURIComponent(b.dataset.remove)}`,
                  ),
                "Person removed.",
              );
          }),
      );
      $(view, "[data-health]").onclick = async () => {
        const box = $(view, "#health");
        box.hidden = false;
        box.innerHTML = String(
          html`<div class="health"><span class="muted">Checking…</span></div>`,
        );
        try {
          health = await api("GET", "/api/admin/health");
          box.innerHTML = String(
            html`${health.checks.map(
                (c) =>
                  html`<div class="health ${c.ok ? "ok" : "bad"}">
                    ${raw(c.ok ? icons.check : icons.alert)}
                    <div><b>${c.name}</b><span>${c.detail}</span></div>
                  </div>`,
              )}
              <div class="health">
                <span class="muted">Environment: ${health.context}</span>
              </div>`,
          );
        } catch (e) {
          box.innerHTML = String(errBox(e));
        }
      };
    };
    function invite() {
      const d = formDrawer({
        title: "Invite someone",
        subtitle: "They get an email with a link to choose a password.",
        submitLabel: "Send invitation",
        fields: [
          { name: "name", label: "Name", placeholder: "Optional" },
          {
            name: "email",
            label: "Email",
            required: true,
            placeholder: "person@example.com",
          },
        ],
        extra: html`<fieldset
          class="full"
          style="border:0;padding:0;margin:6px 0 0"
        >
          <legend class="field">
            <span class="l">Give read-only access to</span>
          </legend>
          <div class="stack" style="--gap:10px;max-height:260px;overflow:auto">
            ${projects.length
              ? projects.map(
                  (p) =>
                    html`<label class="check"
                      ><input
                        type="checkbox"
                        name="proj"
                        value="${p.id}"
                      /><span
                        ><b>${p.title}</b
                        ><small>${p.code} · ${p.clientName}</small></span
                      ></label
                    >`,
                )
              : html`<p class="muted" style="margin:0">
                  No projects yet. You can assign access later from a project
                  page.
                </p>`}
          </div>
        </fieldset>`,
        onSubmit: async (v, form) => {
          const ids = [
            ...form.querySelectorAll("input[name=proj]:checked"),
          ].map((c) => c.value);
          const r = await api("POST", "/api/admin/invite", {
            email: v.email,
            name: v.name,
            projectIds: ids,
          });
          d.close(true);
          toast(
            r.existing
              ? "That person already has an account. Access was updated."
              : "Invitation sent.",
            "ok",
          );
          await load();
          draw();
        },
      });
    }
    draw();
  }

  /* ------------------------------------------------------------------ audit log */
  async function showAudit(view, projectId) {
    document.title = "Audit log · FCV Administration";
    let action = "";
    let entries = [];
    let next = null;
    let pcode = "";
    const ACTIONS = [
      ["", "Everything"],
      ["project", "Projects"],
      ["budget_line", "Budget lines"],
      ["expense", "Expenses"],
      ["supplement", "Supplements"],
      ["draw", "Draw requests"],
      ["remaining_item", "Remaining items"],
      ["document", "Documents"],
      ["user", "People"],
      ["request", "Quote requests"],
      ["auth", "Sign-ins"],
      ["sheet", "Sheet sync"],
    ];
    const qs = (before) =>
      `/api/admin/audit?limit=40${projectId ? "&project=" + projectId : ""}${action ? "&action=" + action : ""}${before ? "&before=" + before : ""}`;
    const item = (a) =>
      html`<div class="audit-item">
        <div class="row wrap-r" style="justify-content:space-between">
          <div>
            <b>${a.summary}</b>
            <div class="when">
              ${a.actor || "system"} ·
              ${dateTime(a.at)}${a.projectCode
                ? html` · <a href="#/p/${a.projectId}">${a.projectCode}</a>`
                : ""}
            </div>
          </div>
          <span class="chip">${a.action}</span>
        </div>
        ${a.before || a.after
          ? html`<details>
              <summary>See what changed</summary>
              ${changes(a)}
            </details>`
          : ""}
      </div>`;
    const changes = (a) => {
      const b = a.before || {};
      const n = a.after || {};
      const keys = [...new Set([...Object.keys(b), ...Object.keys(n)])].filter(
        (k) => JSON.stringify(b[k]) !== JSON.stringify(n[k]),
      );
      const show = (v) =>
        v === undefined || v === null || v === ""
          ? "—"
          : typeof v === "object"
            ? JSON.stringify(v)
            : String(v);
      return html`<pre>
${keys.map(
          (k) =>
            html`${k}:
              ${a.before
                ? html`<span class="diff-old">${show(b[k])}</span> → `
                : ""}<span class="diff-new">${show(n[k])}</span> `,
        )}${a.ip ? `\nfrom ${a.ip}` : ""}</pre
      >`;
    };
    const draw = () => {
      mount(
        view,
        html`<div class="section-head" style="margin-top:0">
            <div>
              <div class="eyebrow">Administration</div>
              <h1 class="display" style="margin-top:10px">Audit log</h1>
              <p class="muted" style="margin:10px 0 0">
                A permanent record of who changed what, and when. Entries can’t
                be edited or deleted by
                anyone.${projectId
                  ? html` Showing one project. <a href="#/audit">Show all</a>`
                  : ""}
              </p>
            </div>
          </div>
          <div class="toolbar">
            <label class="sr" for="af">Filter</label
            ><select class="select" id="af" style="max-width:240px">
              ${ACTIONS.map(
                ([k, l]) =>
                  html`<option
                    value="${k}"
                    ${k === action ? raw("selected") : ""}
                  >
                    ${l}
                  </option>`,
              )}
            </select>
          </div>
          <section class="card pad-0">
            ${entries.length
              ? entries.map(item)
              : html`<div class="empty">
                  ${raw(icons.history)}<b>Nothing recorded yet</b>
                </div>`}
          </section>
          ${next
            ? html`<div class="center" style="margin-top:18px">
                <button class="btn" data-more>Load older entries</button>
              </div>`
            : ""}`,
      );
      $(view, "#af").onchange = (e) => {
        action = e.target.value;
        reload();
      };
      const m = $(view, "[data-more]");
      if (m)
        m.onclick = async () => {
          m.disabled = true;
          try {
            const r = await api("GET", qs(next));
            entries = entries.concat(r.entries);
            next = r.next;
            draw();
          } catch (e) {
            toast(e.message, "bad");
            m.disabled = false;
          }
        };
    };
    const reload = async () => {
      try {
        const r = await api("GET", qs());
        entries = r.entries;
        next = r.next;
        draw();
      } catch (e) {
        mount(view, errBox(e));
      }
    };
    mount(view, html`<div class="skel" style="height:300px"></div>`);
    await reload();
  }

  /* --------------------------------------------------------------- workbook import */
  function showImport(view) {
    document.title = "Import workbook · FCV Administration";
    let parsed = null;
    let b64 = "";
    let fileName = "";
    const drawPick = (msg = "") => {
      mount(
        view,
        html`<div class="section-head" style="margin-top:0">
            <div>
              <div class="eyebrow">Administration</div>
              <h1 class="display" style="margin-top:10px">
                Import a tracker workbook
              </h1>
              <p class="muted" style="margin:10px 0 0;max-width:62ch">
                Load a lender workbook (.xlsx) to create a project with its
                Phase 1 budget, draw requests, expenses and supplements. You’ll
                see a preview and cross-checks before anything is saved. Nothing
                is invented: only what is in the workbook is imported.
              </p>
            </div>
          </div>
          ${msg ? errBox({ message: msg }) : ""}<label
            class="drop"
            id="drop"
            tabindex="0"
            >${raw(icons.upload)}
            <div>
              <b>Choose the .xlsx file</b> or drop it here
              <div class="faint" style="margin-top:6px">Up to 4 MB</div>
            </div>
            <input type="file" id="file" accept=".xlsx" hidden
          /></label>`,
      );
      const drop = $(view, "#drop");
      const input = $(view, "#file");
      drop.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          input.click();
        }
      });
      ["dragenter", "dragover"].forEach((ev) =>
        drop.addEventListener(ev, (e) => {
          e.preventDefault();
          drop.classList.add("over");
        }),
      );
      ["dragleave", "drop"].forEach((ev) =>
        drop.addEventListener(ev, (e) => {
          e.preventDefault();
          drop.classList.remove("over");
        }),
      );
      drop.addEventListener("drop", (e) => {
        if (e.dataTransfer.files[0]) pick(e.dataTransfer.files[0]);
      });
      input.onchange = () => input.files[0] && pick(input.files[0]);
    };
    async function pick(file) {
      if (!/\.xlsx$/i.test(file.name))
        return drawPick("Please choose an .xlsx workbook.");
      mount(view, html`<div class="skel" style="height:260px"></div>`);
      try {
        b64 = await readFile(file);
        fileName = file.name;
        parsed = await api("POST", "/api/admin/import/preview", {
          dataBase64: b64,
        });
        drawPreview();
      } catch (e) {
        drawPick(e.message);
      }
    }
    function drawPreview() {
      const { project: p, report } = parsed;
      const failed = report.checks.filter((c) => !c.ok);
      const tbl = (title, rows, head) =>
        rows.length
          ? html`<section class="card pad-0">
              <div class="card-head">
                <h3>${title} <span class="faint">${rows.length}</span></h3>
              </div>
              <div class="table-wrap">
                <table class="t">
                  <thead>
                    <tr>
                      ${head.map(
                        ([h, c]) => html`<th class="${c || ""}">${h}</th>`,
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    ${rows}
                  </tbody>
                </table>
              </div>
            </section>`
          : "";
      mount(
        view,
        html`<div class="section-head" style="margin-top:0">
            <div>
              <div class="eyebrow">Preview · ${fileName}</div>
              <h1 class="display" style="margin-top:10px">
                ${p.title || p.code}
              </h1>
            </div>
          </div>
          <div class="stack" style="--gap:18px">
            <section class="card">
              <h3 style="margin:0 0 12px">Found in the workbook</h3>
              <ul class="list">
                ${report.found.map((f) => html`<li>${f}</li>`)}
              </ul>
            </section>
            <section class="card">
              <h3 style="margin:0 0 12px">
                Cross-checks against the workbook’s own totals
              </h3>
              ${report.checks.length
                ? report.checks.map(
                    (c) =>
                      html`<div class="health ${c.ok ? "ok" : "bad"}">
                        ${raw(c.ok ? icons.check : icons.alert)}
                        <div>
                          <b>${c.label}</b
                          ><span
                            >Workbook:
                            <span class="num">${money(c.workbook)}</span> ·
                            Calculated:
                            <span class="num">${money(c.computed)}</span> ${c.ok
                              ? "— match"
                              : "— DOES NOT MATCH"}</span
                          >
                        </div>
                      </div>`,
                  )
                : html`<p class="muted" style="margin:0">
                    No totals were found to check.
                  </p>`}
            </section>
            ${report.warnings.length
              ? html`<section class="card">
                  <h3 style="margin:0 0 12px">Please note</h3>
                  ${report.warnings.map(
                    (w) =>
                      html`<div class="callout warn" style="margin-bottom:10px">
                        <span>${raw(icons.alert)}</span>
                        <p>${w}</p>
                      </div>`,
                  )}
                </section>`
              : ""}
            ${tbl(
              "Phase 1 budget lines",
              parsed.budgetLines.map(
                (l) =>
                  html`<tr>
                    <td>${l.category}</td>
                    <td class="num">${l.quantity} ${l.unit}</td>
                    <td class="r num">${money(l.unitPriceCents)}</td>
                    <td>${l.basis}</td>
                  </tr>`,
              ),
              [["Category"], ["Quantity"], ["Unit price", "r"], ["Basis"]],
            )}
            ${tbl(
              "Draw requests",
              parsed.draws.map(
                (d) =>
                  html`<tr>
                    <td>${d.drawRef}</td>
                    <td>${d.purpose}</td>
                    <td class="r num">${money(d.amountRequestedCents)}</td>
                    <td>${d.status}</td>
                  </tr>`,
              ),
              [["ID"], ["Purpose"], ["Requested", "r"], ["Status"]],
            )}
            <form class="card" data-commit novalidate>
              <h3 style="margin:0 0 14px">Create the project</h3>
              <div class="form-grid">
                ${[
                  { name: "code", label: "Project code", required: true },
                  { name: "title", label: "Title", required: true },
                  { name: "clientName", label: "Client name", required: true },
                  { name: "address", label: "Property address" },
                ].map((f) => fieldHtml(f, p[f.name]))}
                <label class="field full"
                  ><span class="l">Stage</span
                  ><select class="select" name="stage">
                    ${STAGES.map(
                      ([k, l]) =>
                        html`<option
                          value="${k}"
                          ${k === (p.stage || "quote_sent")
                            ? raw("selected")
                            : ""}
                        >
                          ${l}
                        </option>`,
                    )}
                  </select></label
                >
                ${failed.length
                  ? html`<label class="check full"
                      ><input type="checkbox" name="accept" /><span
                        ><b>Import anyway</b
                        ><small
                          >I’ve looked at the mismatch above and want to
                          continue.</small
                        ></span
                      ></label
                    >`
                  : ""}
                <div class="full" data-form-error></div>
              </div>
              <div class="row wrap-r" style="margin-top:20px">
                <button class="btn gold" type="submit">
                  ${raw(icons.check)} Import and create project</button
                ><button class="btn" type="button" data-again>
                  Choose a different file
                </button>
              </div>
            </form>
          </div>`,
      );
      $(view, "[data-again]").onclick = () => drawPick();
      const form = $(view, "[data-commit]");
      form.addEventListener("submit", async (e) => {
        e.preventDefault();
        const btn = $(form, "button[type=submit]");
        if (failed.length && !form.elements.accept.checked)
          return showErrors(
            form,
            {},
            "The workbook’s totals don’t match. Review the cross-checks, then tick “Import anyway”.",
          );
        btn.disabled = true;
        showErrors(form, {});
        try {
          const ov = {};
          for (const n of ["code", "title", "clientName", "address", "stage"])
            ov[n] = form.elements[n].value;
          const r = await api("POST", "/api/admin/import/commit", {
            dataBase64: b64,
            overrides: ov,
            acceptMismatch: !!failed.length,
          });
          toast("Project imported.", "ok");
          location.hash = "#/p/" + r.project.id;
        } catch (ex) {
          btn.disabled = false;
          showErrors(form, ex.details, ex.message);
        }
      });
    }
    drawPick();
  }

  /* ------------------------------------------------------------------------ boot */
  F.start({
    area: "admin",
    async onReady({ view }) {
      const render = () => {
        const [seg, a, b] = F.route();
        window.scrollTo({ top: 0 });
        if (seg === "p" && a) return showProject(view, a, b || "summary");
        if (seg === "requests") return showRequests(view);
        if (seg === "people") return showPeople(view);
        if (seg === "audit") return showAudit(view, a);
        if (seg === "import") return showImport(view);
        return showProjects(view);
      };
      F.onRoute(render);
      await render();
    },
  });
})();
