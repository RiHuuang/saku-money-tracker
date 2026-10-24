package id.saku.money

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Test

class AppUpdatePluginTest {
    @Test
    fun readsNormalApkSizeDecodedAsInteger() {
        val metadata = JSONObject().put("bytes", 40_128_200)

        assertEquals(40_128_200L, readExpectedUpdateBytes(metadata))
    }

    @Test
    fun rejectsMissingApkSize() {
        assertEquals(-1L, readExpectedUpdateBytes(JSONObject()))
    }
}
