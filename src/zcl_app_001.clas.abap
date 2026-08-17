CLASS zcl_app_001 DEFINITION PUBLIC.

  PUBLIC SECTION.
    INTERFACES z2ui5_if_app.
    " ONLY bound data here - PUBLIC attributes are serialized every roundtrip
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


CLASS zcl_app_001 IMPLEMENTATION.

  METHOD z2ui5_if_app~main.

    me->client = client.
    IF client->check_on_init( ).
      model_init( ).
      view_display( ).
    ELSEIF client->check_on_navigated( ).
      " a navigated roundtrip is the one that has to put the app back on
      " screen - it carries no event, so it has to be asked about before
      " on_event( ), which would fall through its CASE and render nothing
      view_display( ).
    ELSEIF client->check_on_event( ).
      on_event( ).
    ENDIF.

  ENDMETHOD.

  METHOD view_display.

    " the root: mvc:View with its namespace declarations, written by hand the
    " way a real UI5 view is
    DATA(view) = z2ui5_cl_ui5_view_builder=>factory(
        )->ele( n  = `View`
                ns = `mvc`
            )->a( n = `xmlns`        v = `sap.m`
            )->a( n = `xmlns:mvc`    v = `sap.ui.core.mvc`
            )->a( n = `displayBlock` v = `true`
            )->a( n = `height`       v = `100%` ).

    " Shell gives the app the SAP frame; the nav button appears only when this
    " app was opened from another one, and hands control back to it
    DATA(page) = view->ele( `Shell`
        )->ele( `Page`
            )->a( n = `title`          v = `My abap2UI5 App`
            )->a( n = `showNavButton`  b = client->check_app_prev_stack( )
            )->a( n = `navButtonPress` v = client->_event_nav_app_leave( ) ).

    " come back to the page through the variable rather than through a run of
    " end( )s - it stays readable when the view grows
    page->tag( `Input`
        )->a( n = `value`       v = client->_bind( name )
        )->a( n = `placeholder` v = `Your name` ).

    page->ele( `List`
        )->a( n = `items` v = client->_bind( t_items )

        )->ele( `items`

            )->tag( `StandardListItem`
                )->a( n = `title`       v = `{PRODUCT}`
                " description sits under the title; info would right-align it
                " against the far edge of the row
                )->a( n = `description` v = `{QUANTITY}` ).

    page->tag( `Button`
        )->a( n = `text`  v = `Save`
        )->a( n = `press` v = client->_event( `SAVE` ) ).

    client->view_display( view->stringify( ) ).

  ENDMETHOD.

  METHOD on_event.

    CASE client->get_event( ).
      WHEN `SAVE`.
        " bound data (name, t_items) already carries the user's input here,
        " and a roundtrip that changed it pushes the model by itself - there
        " is nothing to call for that
        client->message_toast_display( |Saved, { name }| ).
    ENDCASE.

  ENDMETHOD.

  METHOD model_init.
    t_items = VALUE #( ( product = `Notebook` quantity = 2 )
                       ( product = `Mouse`    quantity = 5 ) ).
  ENDMETHOD.

ENDCLASS.
