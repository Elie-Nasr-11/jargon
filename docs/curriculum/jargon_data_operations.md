# Jargon Data Operations Notes

Source: `Jargon.docx`

These notes appear to describe an alternate or expanded Jargon language surface for datasets, arrays, insert/remove/update operations, stacks, queues, and tables.

Example Code

## Example 1

name_array = ["Maya", "Sarah", "Leen"]

age_array = [12, 7, 14]

## Example 2

CREATE New Dataset

Structure = Linear

Size = Fixed

Data Type = Numeric

Elements = [12, 7, 14]

Name = "age_array"

Insert = Not Allowed

Remove = Not Allowed

## Example 3

age_array = [12, 7, 14]

UPDATE index (1) = 9

PRINT age_array

END

Output: 

12, 9, 14

## Example 4

name_list = ["Maya", "Sarah", "Leen"]

INSERT index (2) = "Jamal"

PRINT name_list

END

Output: 

Maya, Sarah, Jamal, Leen

## Example 5

age_list = [12, 9, 14]

INSERT index (2) = 11

PRINT age_list

END

Output: 

12, 9, 11, 14

## Example 6

age_list = [12, 9, 11, 14]

REMOVE index (0) = 12

INSERT index (2) = 12

PRINT age_list

END

Output: 

9, 11, 12, 14

## Example 7

name_list = ["Maya", "Sarah", "Jamal", "Leen" ]

REMOVE index (0) = "Maya"

INSERT index (2) = "Maya"

PRINT name_list

END

Output: 

Sarah, Jamal, Maya, Leen

## Example 8

sibling_list = [ ("Maya", 12), ("Sarah", 9), ("Jamal", 11), ("Leen", 14)]

PRINT sibling_list

END

Output: 

Maya, 12, Sarah, 9, Jamal, 11, Leen, 14

## Example 9

sibling_list = [ ("Maya", 12), ("Sarah", 9), ("Jamal", 11), ("Leen", 14)]

REMOVE index (0) = ("Maya" , 12)

INSERT index (2) = ("Maya" , 12)

PRINT sibling_list

END

Output: 

Sarah, 9, Jamal, 11, Maya, 12, Leen, 14

## Example 10

CREATE New Dataset

Structure = Linear

Size = Dynamic

Data Type = Any

Elements = ["A", "B", "C"]

Name = "file_stack"

Insert = To End

Remove = From End

## Example 11

CREATE New Dataset

Structure = Linear

Size = Dynamic

Data Type = Any

Elements = []

Name = "tv_stack"

Insert = To End

Remove = From End

Output: 

tV _stack = []

IF tv = inbound THEN

OPEN tv_ stack

READ tv_sku

INSERT index (END) = tv_sku

SEND tv TO shelf

END

Output: 

tv_stack = [

"TV-55S4K-BLK-342"

]

Output: 

tv_stack = [

"TV-55S4K-BLK-342"

"TV-55S4K-BLK-110"

"TV-55S4K-BLK-729"

"TV-55S4K-BLK-845"

]

## Example 12

IF tv = outbound THEN

OPEN tv_ stack

REMOVE index (END) = tv_sku

FIND tv = tv_sku

SEND tv TO client

END

Output: 

tv_stack = [

"TV-55S4K-BLK-342"

"TV-55S4K-BLK-110"

"TV-55S4K-BLK-729"

]

## Example 13

IF apple_crate = outbound THEN

OPEN apple_queue

REMOVE index (END) = crate_sku

FIND apple_crate = crate_sku

SEND apple_crate TO client

END

Output: 

apple_queue = [

"APL-1025-20M-445"

"APL-1025-20M-129""

]

## Example 14

CREATE New Dataset

Structure = Tree

Size = Dynamic

Data Type = Any

Elements = []

Node = (parent index, data)

Name = "food_inventory"

Insert = any position

Remove = any position

Output: 

food_inventory = []

food_inventory = []

INSERT node (R, "Food")

PRINT food_inventory

END

Output: 

Food

food_inventory = [ (R, "Food" ) ]

INSERT node (R_O, "Meat")

INSERT node (R_1, "Fruit")

INSERT node (R_2, "Vegetable")

PRINT food_ inventory

END

Output: 

Food

|_____Meat

|_____Fruit

|_____Vegetable

food_inventory = [ (R, "Food" ),

(R_O, "Meat"),

(R_1, "Fruit"),

(R_2, "Vegetable")

]

INSERT node (R_1_0, "Apple")

PRINT food_ inventory

END

Output: 

Food

|_____Meat

|_____Fruit

<w:t xml:space="preserve">|_____Apple

|_____Vegetable

food_inventory = [(R, "Food" ) ,

(R_O, "Meat"),

(R_1, "Fruit"),

(R_2, "Vegetable")

(R_1_0, "Apple"

]

REMOVE node (R_1)

PRINT food_inventory

END

Output: 

Food

|_____Meat

|_____Vegetable

food_inventory = [(R, "Food" ) ,

(R_O, "Meat"),

(R_1, "Fruit"),

(R_2, "Vegetable")

(R_1_0, "Apple"

SWAP node (R_ 1), (R_2) PRINT food_inventory

END

Output: 

Food

|_____Meat

|_____Vegetable

|_____Fruit

|_____Apple

## Example 15

CREATE New Dataset

Structure = Graph

Size = Dynamic

Data Type = Any

Elements = []

Node = (node_index, data, (linked_node, edge) )

Name = "delivery_map"

Insert = any position

Remove = any position

Output: 

delivery_map = []

delivery_map = []

INSERT node (A, "Seville")

END

Output: 

delivery_map = [ (A, "Seville")]

delivery_map = [(A, "Seville")]

INSERT node (B, "Madrid", (A, 538) ) INSERT node (C, "Barcelona", (A, 1031) )

INSERT node (D, "Valencia", (A, 653) )

END

Output: 

delivery_map = [

(A, "Seville", (B, 538) , (C,1031) , (D,653)),

(B, "Madrid", (A, 538) )

(C, "Barcelona", (A, 1031))

(D, "Valencia", (A, 653) )

]

delivery_map = [

(A, "Seville", (B, 538), (C, 1031), (D, 653)) , (B, "Madrid", (A, 538))

(C, "Barcelona", (A, 1031) )

(D, "Valencia", (A, 653) )

Trip_ 1 = AB + BA

Trip_ 2 = AC + CA

Trip_3 = AD + DA

Trip_All = Trip_1 + Trip_ 2 + Trip_3

PRINT Trip_All

END

Output: 

4444

delivery_map = [

(A, "Seville", (B, 538), (C, 1031), (D, 653) ),

(B, "Madrid", (A, 538))

(C, "Barcelona", (A, 1031) )

(D, "Valencia", (A, 653) )

]

INSERT edge (B:C, 621)

INSERT edge (C:D,351)

PRINT delivery_ map

END

Output: 

delivery_map = [

(A, "Seville", (B, 538), (C,1031) , (D,653)), (B, "Madrid", (A, 538), (C,621)) ,

(C, "Barcelona", (A,1031), (B, 621) , (D,351)), (D, "Valencia", (A, 653) , (C,351) )

]

delivery_map = [

(A, "Seville", (B, 538), (C, 1031) , (D, 653) ) ,

(B, "Madrid" , (A, 538) , (C, 621) ) ,

(C, "Barcelona", (A, 1031) , (B, 621) , (D, 351) ) ,

(D, "Valencia", (A, 653) , (C, 351) )

Trip_A1l = AB + BC + CD + DA

PRINT Trip_ All

END

Output: 

2163

## Example 16

START LinearSearch

OPEN list

SET search_index (0)

REPEAT_UNTIL search_index reaches end of list

READ data_item AT: search _index

IF data_item = target THEN

PRINT "Found it!"

END LinearSearch

ELSE

SET search_index (search_index + 1)

PRINT "Not found"

END LinearSearch

## Example 17

START BinarySearch

OPEN list

SET start_index (0)

SET end index (last index of dataset)

REPEAT_UNTIL search_ index reaches end of list

SET midpoint = (start_index + end_index) /2

SET search_ index (midpoint)

READ data_item AT: search_ index

IF data item = target THEN

PRINT "Found it!"

END BinarySearch

ELSE IF data_item > target THEN

SET end_ index (search_index - 1)

ELSE

SET start_ index (search_index + 1)

PRINT "Not found"

END BinarySearch
