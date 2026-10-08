package id.saku.money

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class WidgetSheetMirrorTest {
    private fun rows(array: JSONArray) = (0 until array.length()).map { index ->
        val row = array.getJSONArray(index)
        (0 until row.length()).map(row::getString)
    }
    @Test fun nativePlannerMatchesWebAndResumesWithIdenticalBoundaries() {
        val fixture = JSONObject(javaClass.getResource("/sheet-parity.json")!!.readText())
        val before = fixture.getJSONObject("before")
        val after = fixture.getJSONObject("after")
        val tables = fixture.getJSONObject("tables")
        for ((name, rows) in WidgetSheetMirror.tables(before)) {
            assertEquals(name, rows(tables.getJSONArray(name)), rows)
        }
        val (changes, grid) = WidgetSheetMirror.plan(before, after)
        val expected = fixture.getJSONArray("changes")
        assertEquals(expected.length(), changes.size)
        changes.forEachIndexed { index, change ->
            val wanted = expected.getJSONObject(index)
            assertEquals(wanted.getString("range"), change.getString("range"))
            for (key in listOf("before", "after")) assertEquals(rows(wanted.getJSONArray(key)), rows(change.getJSONArray(key)))
            assertTrue(WidgetSheetMirror.json(change).toByteArray(Charsets.UTF_8).size < 150_000)
            assertTrue(change.getJSONArray("after").length() <= 150)
        }
        val expectedGrid = fixture.getJSONObject("grid")
        assertEquals(expectedGrid.length(), grid.length())
        expectedGrid.keys().forEach { key -> assertEquals(expectedGrid.getInt(key), grid.getInt(key)) }
        assertTrue(WidgetSheetMirror.plan(after, after).first.isEmpty())
    }
}
