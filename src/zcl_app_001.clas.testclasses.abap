" The starter app under ABAP Unit, without a system in the loop.
"
" An abap2UI5 app is one class with one entry point, main( client ), and
" everything it does goes through the z2ui5_if_client it is handed: the
" lifecycle questions it asks (check_on_init, check_on_navigated,
" check_on_event), the event it dispatches on (get_event), and the two things
" it does back (view_display, message_toast_display). So the whole app is
" testable with a test double for that one interface - no framework runtime,
" no HTTP, no draft table.
"
" Runs on the system via ABAP Unit (SE24 / ADT: Ctrl+Shift+F10). The local
" gates do not execute it - abaplint checks it statically, the abap2UI5-linter
" skips *.testclasses.abap - so a green `npm run check` says the test compiles
" against the framework's API, and the system says whether it passes.

CLASS ltd_client DEFINITION FINAL FOR TESTING.

  PUBLIC SECTION.
    " PARTIALLY IMPLEMENTED: the methods the app does not ask this double for
    " (_bind, _event, check_app_prev_stack, ...) are generated empty and
    " answer initial - which is exactly what a view string test needs
    INTERFACES z2ui5_if_client PARTIALLY IMPLEMENTED.

    " what the app's lifecycle questions are answered with
    DATA init      TYPE abap_bool.
    DATA navigated TYPE abap_bool.
    DATA event     TYPE abap_bool.
    DATA event_id  TYPE string.

    " what the app did back, in order
    DATA t_view  TYPE string_table.
    DATA t_toast TYPE string_table.

ENDCLASS.


CLASS ltd_client IMPLEMENTATION.

  METHOD z2ui5_if_client~check_on_init.
    result = init.
  ENDMETHOD.

  METHOD z2ui5_if_client~check_on_navigated.
    result = navigated.
  ENDMETHOD.

  METHOD z2ui5_if_client~check_on_event.
    result = event.
  ENDMETHOD.

  METHOD z2ui5_if_client~get_event.
    result = event_id.
  ENDMETHOD.

  METHOD z2ui5_if_client~view_display.
    APPEND val TO t_view.
  ENDMETHOD.

  METHOD z2ui5_if_client~message_toast_display.
    APPEND text TO t_toast.
  ENDMETHOD.

ENDCLASS.


CLASS ltcl_app DEFINITION FINAL FOR TESTING
  RISK LEVEL HARMLESS DURATION SHORT.

  PRIVATE SECTION.
    DATA app    TYPE REF TO zcl_app_001.
    DATA client TYPE REF TO ltd_client.

    METHODS setup.
    METHODS first_call_seeds_and_displays FOR TESTING RAISING cx_static_check.
    METHODS save_toasts_the_name          FOR TESTING RAISING cx_static_check.
    METHODS navigated_redisplays_only     FOR TESTING RAISING cx_static_check.

ENDCLASS.


CLASS ltcl_app IMPLEMENTATION.

  METHOD setup.
    app = NEW #( ).
    client = NEW #( ).
  ENDMETHOD.

  METHOD first_call_seeds_and_displays.

    " the first roundtrip of a fresh instance: the framework answers both
    " check_on_init and check_on_navigated with true
    client->init      = abap_true.
    client->navigated = abap_true.

    app->z2ui5_if_app~main( client ).

    " model_init seeded the two rows ...
    cl_abap_unit_assert=>assert_equals( exp = 2
                                        act = lines( app->t_items ) ).
    cl_abap_unit_assert=>assert_equals( exp = `Notebook`
                                        act = app->t_items[ 1 ]-product ).

    " ... and view_display put the view on screen, once, with the input
    " and the list the starter app is made of
    cl_abap_unit_assert=>assert_equals( exp = 1
                                        act = lines( client->t_view ) ).
    DATA(view) = client->t_view[ 1 ].
    cl_abap_unit_assert=>assert_true( xsdbool( view CS `<Input` ) ).
    cl_abap_unit_assert=>assert_true( xsdbool( view CS `<List` ) ).
    cl_abap_unit_assert=>assert_initial( client->t_toast ).

  ENDMETHOD.

  METHOD save_toasts_the_name.

    " an event roundtrip: the bound data already carries the user's input
    " when main( ) is called - the framework wrote it into the attribute
    client->event    = abap_true.
    client->event_id = `SAVE`.
    app->name        = `World`.

    app->z2ui5_if_app~main( client ).

    cl_abap_unit_assert=>assert_equals( exp = 1
                                        act = lines( client->t_toast ) ).
    cl_abap_unit_assert=>assert_equals( exp = `Saved, World`
                                        act = client->t_toast[ 1 ] ).
    " an event does not rebuild the view - the changed model is pushed by itself
    cl_abap_unit_assert=>assert_initial( client->t_view ).

  ENDMETHOD.

  METHOD navigated_redisplays_only.

    " first start seeds the model ...
    client->init      = abap_true.
    client->navigated = abap_true.
    app->z2ui5_if_app~main( client ).

    " ... the user changes it (the framework restores the instance with the
    " changed attributes between roundtrips) ...
    app->t_items = VALUE #( ( product = `Keyboard` quantity = 1 ) ).

    " ... and a return into the app (nav_app_leave, a value help closing) is a
    " navigated roundtrip: check_on_init stays false
    client->init = abap_false.
    app->z2ui5_if_app~main( client ).

    " the view was displayed again, and the model was NOT seeded again
    cl_abap_unit_assert=>assert_equals( exp = 2
                                        act = lines( client->t_view ) ).
    cl_abap_unit_assert=>assert_equals( exp = 1
                                        act = lines( app->t_items ) ).
    cl_abap_unit_assert=>assert_equals( exp = `Keyboard`
                                        act = app->t_items[ 1 ]-product ).

  ENDMETHOD.

ENDCLASS.
