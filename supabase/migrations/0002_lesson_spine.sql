-- Lesson spine v1: metadata columns plus runnable starter programs.
-- Live note: 0001_init is already applied on qztpieiizmiayzjhezwh; apply this as a new migration.

alter table public.lessons
  add column if not exists module text not null default 'Processes';

alter table public.lessons
  add column if not exists level text not null default 'Level 0-1';

alter table public.lessons
  add column if not exists expected_output text;

insert into public.lessons (
  id,
  position,
  title,
  module,
  level,
  tutor_prompt,
  sample_code,
  expected_output
) values
(
  'lesson1',
  1,
  'Purpose',
  'Processes',
  'Level 0-1',
  $lesson1_prompt$Technology is made for a purpose. Help the learner connect a tool to the job it performs, then ask them to name another tool and purpose pair.$lesson1_prompt$,
  $lesson1_code$// Purpose starter
SET tool ("hammer")
SET purpose ("hammers nails")
PRINT (tool + " -> " + purpose)$lesson1_code$,
  $lesson1_output$hammer -> hammers nails$lesson1_output$
),
(
  'lesson2',
  2,
  'Systems & Signals',
  'Processes',
  'Level 0-1',
  $lesson2_prompt$A system changes inputs into outputs through a process. Help the learner label the input signal, the process, and the output signal.$lesson2_prompt$,
  $lesson2_code$// Systems and signals starter
SET input_signal ("button press")
SET process ("elevator decides where to go")
SET output_signal ("door opens")
PRINT ("Input: " + input_signal)
PRINT ("Process: " + process)
PRINT ("Output: " + output_signal)$lesson2_code$,
  $lesson2_output$Input: button press
Process: elevator decides where to go
Output: door opens$lesson2_output$
),
(
  'lesson3',
  3,
  'Signal Processing',
  'Processes',
  'Level 0-1',
  $lesson3_prompt$Processing changes one form of signal into another. Guide the learner to trace how a sensor converts a physical signal for the computer.$lesson3_prompt$,
  $lesson3_code$// Signal processing starter
SET signal ("sound")
SET converted ("electronic")
IF signal is equal to "sound" THEN
    PRINT ("Microphone changes sound into " + converted + " signals")
ELSE
    PRINT "Signal needs a different interface"
END$lesson3_code$,
  $lesson3_output$Microphone changes sound into electronic signals$lesson3_output$
),
(
  'lesson4',
  4,
  'Memory',
  'Processes',
  'Level 0-2',
  $lesson4_prompt$Memory stores signals while a system is working. Help the learner see a list as a simple memory structure that can hold and replay stored items.$lesson4_prompt$,
  $lesson4_code$// Memory starter
SET memory ([])
ADD "camera input" to memory
ADD "processed photo" to memory
SET i (0)
REPEAT_UNTIL i reaches end of memory
    PRINT memory[i]
    SET i (i + 1)
END$lesson4_code$,
  $lesson4_output$camera input
processed photo$lesson4_output$
),
(
  'lesson5',
  5,
  'Exchanging Signals',
  'Processes',
  'Level 0-1',
  $lesson5_prompt$Systems exchange signals across interfaces. Help the learner trace a message as it moves across multiple systems.$lesson5_prompt$,
  $lesson5_code$// Exchanging signals starter
SET route (["phone", "cell tower", "internet", "server"])
REPEAT_FOR_EACH stop in route
    PRINT ("Signal reaches " + stop)
END$lesson5_code$,
  $lesson5_output$Signal reaches phone
Signal reaches cell tower
Signal reaches internet
Signal reaches server$lesson5_output$
),
(
  'coding1',
  6,
  'Turn a Process Into Code',
  'Coding',
  'Level 1-2',
  $coding1_prompt$Turn a real process into ordered Jargon instructions. Emphasize that each line should map to one clear step.$coding1_prompt$,
  $coding1_code$// Sequence starter
SET step1 ("Gather ingredients")
SET step2 ("Mix")
SET step3 ("Serve")
PRINT step1
PRINT step2
PRINT step3$coding1_code$,
  $coding1_output$Gather ingredients
Mix
Serve$coding1_output$
),
(
  'coding2',
  7,
  'Conditions and Comparisons',
  'Coding',
  'Level 1-2',
  $coding2_prompt$Use IF and ELSE to choose between two paths. Ask the learner what condition changes the output.$coding2_prompt$,
  $coding2_code$// Condition starter
SET temperature (15)
IF temperature is less than 20 THEN
    PRINT "Wear a jacket"
ELSE
    PRINT "No jacket needed"
END$coding2_code$,
  $coding2_output$Wear a jacket$coding2_output$
),
(
  'coding3',
  8,
  'Lists and Looping',
  'Coding',
  'Level 2',
  $coding3_prompt$Use a list, a loop, and a condition together. Guide the learner to explain why each selected number is included.$coding3_prompt$,
  $coding3_code$// Lists and looping starter
SET nums ([1, 6, 9, 12, 14, 18])
SET selected ([])

REPEAT_FOR_EACH x in nums
    IF x is even AND (x % 3) is equal to 0 THEN
        ADD x to selected
    END
END

PRINT selected$coding3_code$,
  $coding3_output$[6, 12, 18]$coding3_output$
),
(
  'coding4',
  9,
  'Inputs and Outputs',
  'Coding',
  'Level 2',
  $coding4_prompt$Use ASK to collect input, store it, and respond. Guide the learner to predict how the same program changes for different names.$coding4_prompt$,
  $coding4_code$// Input and output starter
ASK "Enter a name" as name
SET people (["Ali", "Fatima", "Rami"])
REPEAT_FOR_EACH person in people
    IF name is equal to person THEN
        PRINT "Found!"
    END
END$coding4_code$,
  $coding4_output$Found!$coding4_output$
),
(
  'coding5',
  10,
  'Final Logic Lab',
  'Coding',
  'Level 2',
  $coding5_prompt$Combine variables, a loop, a condition, and BREAK. Help the learner trace how the result changes each time through the loop.$coding5_prompt$,
  $coding5_code$// Final logic lab starter
SET num (5)
SET result (1)
SET i (1)

REPEAT 100 times
    IF i is greater than num THEN
        PRINT result
        BREAK
    END
    SET result (result * i)
    SET i (i + 1)
END$coding5_code$,
  $coding5_output$120$coding5_output$
)
on conflict (id) do update set
  position = excluded.position,
  title = excluded.title,
  module = excluded.module,
  level = excluded.level,
  tutor_prompt = excluded.tutor_prompt,
  sample_code = excluded.sample_code,
  expected_output = excluded.expected_output;
