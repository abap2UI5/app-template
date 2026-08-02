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
    ELSEIF client->check_on_event( ).
      on_event( ).
    ENDIF.

  ENDMETHOD.

  METHOD view_display.

    DATA(view) = z2ui5_cl_ai_xml=>factory( ).

    view->open( n  = `View`
                ns = `mvc`
        )->a( n = `xmlns`
              v = `sap.m`
        )->a( n = `xmlns:mvc`
              v = `sap.ui.core.mvc`
        )->a( n = `displayBlock`
              v = `true`
        )->a( n = `height`
              v = `100%`

        )->open( `Page`
            )->a( n = `title`
                  v = `My abap2UI5 App`

            )->leaf( `Input`
                )->a( n = `value`
                      v = client->_bind( name )

            )->open( `List`
                )->a( n = `items`
                      v = client->_bind( t_items )
                )->open( `items`
                    )->leaf( `StandardListItem`
                        )->a( n = `title`
                              v = `{PRODUCT}`
                        )->a( n = `info`
                              v = `{QUANTITY}`

                )->shut(
            )->shut(

            )->leaf( `Button`
                )->a( n = `text`
                      v = `Save`
                )->a( n = `press`
                      v = client->_event( `SAVE` ) ).

    client->view_display( view->stringify( ) ).

  ENDMETHOD.

  METHOD on_event.

    CASE client->get( )-event.
      WHEN `SAVE`.
        " bound data (name, t_items) already carries the user's input here
        client->message_toast_display( |Saved, { name }| ).
        client->view_model_update( ).
    ENDCASE.

  ENDMETHOD.

  METHOD model_init.
    t_items = VALUE #( ( product = `Notebook` quantity = 2 )
                       ( product = `Mouse`    quantity = 5 ) ).
  ENDMETHOD.

ENDCLASS.
