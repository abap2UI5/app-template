# AGENTS.md — abap2UI5 app template

Briefing for AI assistants (and humans) developing **this abap2UI5 app
repository**, created from
[abap2UI5/app-template](https://github.com/abap2UI5/app-template) with the
validation gates preconfigured. Two parts: this repository (yours — rewrite
it, add your own rules), then the essentials of building an app (generated).

## This repository

| Path | Purpose |
| --- | --- |
| `src/` | The app classes, one `ZCL_*` class per app (abapGit, `STARTING_FOLDER=/src/`). `zcl_app_001` is the starter app with its ABAP Unit include — copy it for a new app |
| `abaplint.jsonc` | Gate 1. Clones the abap2UI5 framework for dependency resolution, pinned to release tag `1.151.0` (key `"branch"`); `npm run check:pin` holds the places that name it to one number |
| `abap2ui5lint.jsonc` | Gate 2, the [abap2UI5-linter](https://github.com/abap2UI5/linter): every view checked statically and rendered headless |
| `.claude/skills/` | Four skills, loaded on demand: `build-an-app`, `view-chain-layout`, `abap-check`, `ui5-check` — a short `SKILL.md` each, long sections under `references/` |
| `.claude/skills/build-an-app/references/building-apps.md` | **The full app-building guide** — the one copy; its essentials are below |
| `docs/project.md` | This section in detail: every file, the gates, addons, testing, the 7.02 and rename scripts |

## Build & verify — run before every commit

```bash
npm ci                          # once - both gates, from the lockfile
npx playwright install chromium # once - the render gate needs a browser
npm run check                   # abaplint + linter, expect 0 issues
npm run check:abap2ui5:fast     # fast loop: the linter without the render gate
npm run fix                     # apply the linter's mechanical corrections
npm run test:unit               # the ABAP Unit tests, transpiled - no system
npm run check:all               # what CI runs: the pin, then both gates
npm run doctor                  # a gate failed oddly? one line per cause, with the remedy
npm run add-addon -- popups     # the app calls an addon class: register the addon
```

- A gate that names a symptom, not a cause — a syntax error inside
  `node_modules`, "browser not found", "Class z2ui5_cl_popup_... not found" —
  is what `npm run doctor` explains. It is offline and takes a second.
- Every `.clas.abap` needs its `.clas.xml` sidecar: UTF-8 **with BOM**, LF,
  `CLSNAME` equal to the file name — copy an existing one. Class names are
  `ZCL_*`/`ZCX_*`. Everything in English.
- An addon ([abap2UI5-addons](https://abap2ui5-addons.github.io/)) is a
  separate abapGit install and unknown to the lint gate until
  `npm run add-addon -- <repo>` registered it; `-- --list` shows them all.
- Without a system the gates are all there is: say which ran. Deploy with
  [abapGit](https://abapgit.org/), start with `<endpoint>?app_start=zcl_app_001`.

## The MCP server — use it when it is connected

`.mcp.json` registers the [abap2UI5 MCP server](https://github.com/abap2UI5/mcp-server)
(`.claude/settings.json` pre-approves it for Claude Code). When its tools are
in your tool list, they answer from the framework, the samples and the docs
as they are today — prefer them over what you remember:

- **First:** `setup_status` — what resolves, what is built, what is missing.
- **Before writing:** `capabilities` (can abap2UI5 express this at all?),
  `examples` + `read_example` (a working app that already does it),
  `api_reference` (the client API, instead of guessing a method), `addons`
  (does an add-on already do it?), `app_guide` and `docs_search`.
- **After every view change:** `validate_view` (and `fix_view`), next to
  `npm run check`.
- **Running it without a system:** `deploy_app` → `build_backend` →
  `run_app` / `screenshot_view`, then `app_act` to click through it.

Not connected? Everything here still works without it — the guide, the skills
and the gates are all in this repository.

## What to read when

| Doing | Read |
| --- | --- |
| Writing or changing an app class | the essentials below, then the guide's section for the topic; the `build-an-app` skill is the checklist |
| Laying out a view chain | the `view-chain-layout` skill, then `npm run fix` |
| Finishing a change under `src/` | `abap-check`: its `SKILL.md`, then references 1 and 2 |
| Writing or reviewing a view | `ui5-check`: its `SKILL.md`, then reference 1 |
| A gate, the pin, an addon, a test, 7.02, a renamed framework | `docs/project.md` |

<!-- guide-essentials:begin - GENERATED from abap2UI5's docs/agents/building-apps.md by scripts/generate-agents.mjs in abap2UI5/app-template. Do not edit between this line and guide-essentials:end; put your own rules above. -->

## Building an app - the essentials

What follows is cut out of the framework's app-building guide, word for word. The whole guide is ONE file, `.claude/skills/build-an-app/references/building-apps.md`; §N below is its section N. Read the section before you rely on a line here - and the whole of §2 to §5 before a first app.

### 1. The model in one paragraph

An abap2UI5 app is **one ABAP class** implementing `z2ui5_if_app`. The
framework calls its `main( client )` method on every HTTP roundtrip, and the
app dispatches on why it was called: it has to put its view on screen
(`check_on_navigated`, true on the first start and on every return into the
app), or the user interacted with it (`check_on_event`), or it is running for
the very first time and has one-time setup to do (`check_on_init`). The first
two are the dispatcher; the third is a branch an app only carries when it has
something to seed once. All three are arms of ONE `IF`/`ELSEIF` chain (§2).
The app builds a UI5 XML view as a string, binds ABAP attributes into it,
and registers named events. Between roundtrips the framework
serializes the app object into a draft table and restores it — **every
attribute, whatever its section, is persisted state; only the bound ones
travel to the browser**. `_bind( )` needs a PUBLIC attribute, so bound data
goes in `PUBLIC SECTION`, everything else in `PROTECTED SECTION`.
There is no JavaScript, no OData service and no deployment step: activate the
class, call the ICF endpoint with `?app_start=zcl_my_app`.

### 2. The canonical app template

```abap
CLASS zcl_my_app DEFINITION PUBLIC.

  PUBLIC SECTION.
    INTERFACES z2ui5_if_app.
    " ONLY bound data here - _bind( ) needs PUBLIC, every attribute is persisted
    TYPES: BEGIN OF ty_s_item,
             product  TYPE string,
             quantity TYPE i,
           END OF ty_s_item.
    DATA t_items TYPE STANDARD TABLE OF ty_s_item WITH EMPTY KEY.
    DATA name    TYPE string.

  PROTECTED SECTION.
    DATA client TYPE REF TO z2ui5_if_client.
    METHODS view_display.
    METHODS on_event.
    METHODS model_init.

  PRIVATE SECTION.
ENDCLASS.


CLASS zcl_my_app IMPLEMENTATION.

  METHOD z2ui5_if_app~main.

    me->client = client.
    IF client->check_on_init( ).
      model_init( ).
      view_display( ).
    ELSEIF client->check_on_navigated( ).
      view_display( ).
    ELSEIF client->check_on_event( ).
      on_event( ).
    ENDIF.

  ENDMETHOD.

  METHOD view_display.

    DATA(view) = z2ui5_cl_ui5_view_builder=>factory(
        )->ele( n = `View` ns = `mvc`
            )->a( n = `xmlns`     v = `sap.m`
            )->a( n = `xmlns:mvc` v = `sap.ui.core.mvc`
            )->a( n = `displayBlock` v = `true`
            )->a( n = `height`       v = `100%`

            )->ele( `Page`
                )->a( n = `title` v = `My App`

                )->tag( `Input`
                    )->a( n = `value` v = client->_bind( name )

                )->ele( `List`
                    )->a( n = `items` v = client->_bind( t_items )

                    )->ele( `items`

                        )->tag( `StandardListItem`
                            )->a( n = `title` v = `{PRODUCT}`
                            )->a( n = `info`  v = `{QUANTITY}`

                    )->end(
                )->end(

                )->tag( `Button`
                    )->a( n = `text`  v = `Save`
                    )->a( n = `press` v = client->_event( `SAVE` ) ).

    client->view_display( view->stringify( ) ).

  ENDMETHOD.

  METHOD on_event.

    CASE client->get_event( ).
      WHEN `SAVE`.
        " bound data (name, t_items) already carries the user's input here,
        " and the changed model is pushed back automatically
        client->message_toast_display( |Saved, { name }| ).
    ENDCASE.

  ENDMETHOD.

  METHOD model_init.
    t_items = VALUE #( ( product = `Notebook` quantity = 2 )
                       ( product = `Mouse`    quantity = 5 ) ).
  ENDMETHOD.

ENDCLASS.
```

- **Do:** one chain — `IF client->check_on_init( ).` (seed, then display),
  `ELSEIF client->check_on_navigated( ).` (display), `ELSEIF
  client->check_on_event( ).` (dispatch), as in the template.

### What you remember may be the old API (§3)

**Names that changed.** Most of what was written about abap2UI5 before
1.143.0 names an API that has been replaced; when one of these comes to mind,
write the right-hand side:

| Remembered | Write |
|---|---|
| `z2ui5_cl_xml_view=>factory( )->shell( )->page( )` | `z2ui5_cl_ui5_view_builder` as above — the legacy fluent builder (one method per control) is frozen and since 1.151.0 only exists where [abap2UI5-ext](https://github.com/abap2UI5/abap2UI5-ext) is installed |
| `_bind_edit( )`, `view_model_update( )` | `_bind( )`; delete the update call (§4) |
| a `check_initialized` flag | `client->check_on_init( )` (§2) |
| `client->get( )-event`, `get( )-t_event_arg` | `client->get_event( )`, `client->get_event_arg( )` (§5) |
| `_event_client( )` | `follow_up_action( )` (§5) |
| `nav_app_leave( client->get_app( client->get( )-s_draft-id_prev_app_stack ) )` | `client->nav_app_leave( )` (§7) |
| `z2ui5_cl_pop_to_confirm` and the other `z2ui5_cl_pop_*` | `z2ui5_cl_popup_*` of the popups addon (§6) |
| `z2ui5_cl_util=>…` | no longer in the framework and no API for apps — write the few lines yourself |

Every replaced name with old and new code:
<https://abap2ui5.github.io/docs/resources/deprecations.html>, as data
<https://abap2ui5.github.io/docs/api/deprecations.json>. The linter (§9)
reports them from that same data: `removed-api` names the release a name
left in and what to write instead, and a class still on the frozen builder
is judged by every rule that needs no view.

### Four rules that are cheap to break (§3, §4, §8)

- **Booleans from ABAP variables** go through `b` instead of `v`:
  `` )->a( n = `editable` b = mv_edit_mode ) `` renders `true`/`false` (a
  literal is just `` v = `true` `` — never feed `abap_true` into `v` raw, it
  serializes as `X`).
- **An element gets its attributes before its first child.** `a( )` lands on
  the element the chain is pointing at — the child just added by `ele( )` or
  `tag( )`, or the node itself while it has none. Once an element has a
  child, `a( )` can no longer reach it.
- **Never hard-code a model path as text** (`'/T_ITEMS'`): paths come from
  `_bind`, so renames cannot break bindings. For raw binding-info strings
  (typed bindings, sorters) get the bare path via
  `client->_bind_path( t_items )`, e.g.
  `` v = |\{ path: '{ client->_bind_path( t_items ) }', sorter: \{ path: 'PRODUCT' \} \}| ``.
- **State discipline**: every attribute - PUBLIC, PROTECTED and PRIVATE
  alike - is serialized into the draft on every roundtrip; only the bound
  ones are sent to the browser. Moving a large catalog to PROTECTED does not
  shrink the draft: data the next roundtrip does not need is CLEARed or
  re-read per request. Keep the PUBLIC section to what is bound - the
  framework walks every public structure and reference each roundtrip.

### An addon class the lint gate does not find (§6, §9)

- **`npm run add-addon -- <repo>`** in a project made from app-template
  (`popups`, `range-filter`, …): registers an addon, and what it depends on,
  in the dependencies of `abaplint.jsonc`, so the lint gate resolves its
  classes. Without it a call to an addon class ends in "Class ... not found" —
  which says the gate does not know the addon, not that the class is wrong.

### Where to read on

Sections of `.claude/skills/build-an-app/references/building-apps.md`:

| § | Read it for |
|---|---|
| 1 | The model in one paragraph |
| 2 | The canonical app template |
| 3 | The view builder — `z2ui5_cl_ui5_view_builder` - Formatting the chain (strict, and machine-checked) |
| 4 | Data binding |
| 5 | Events |
| 6 | Popups, popovers, messages |
| 7 | Multi-view, navigation, routing |
| 8 | Rules that keep apps portable |
| 9 | Validate and iterate like the framework does |
| 10 | The in-app developer tools (Ctrl+F12) - Starting them; What you find there; When they do not open |
| 11 | Calling a language model |

<!-- guide-essentials:end -->
