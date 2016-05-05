export const MSG_CREATE_ROUTE = 0x00
export const LENGTH_MSG_CREATE_ROUTE = 1 + 4 /* player 1 ID */ + 4 /* player 2 ID */ + 32 /* mac */

export const MSG_CREATE_ROUTE_SUCCESS = 0x01
export const LENGTH_MSG_CREATE_ROUTE_SUCCESS =
    1 + 4 /* player 1 ID */ + 4 /* player 2 ID */ + 8 /* route ID */

export const MSG_CREATE_ROUTE_SUCCESS_ACK = 0x02
export const MSG_CREATE_ROUTE_FAILURE = 0x03
export const MSG_CREATE_ROUTE_FAILURE_ACK = 0x04
